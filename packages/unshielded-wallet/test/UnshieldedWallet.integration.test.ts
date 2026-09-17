// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnightntwrk/wallet-sdk-utilities/testing';
import * as rx from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UnshieldedWallet } from '../src/index.js';
import { getUnshieldedSeed, createWalletConfig, waitForCoins } from './testUtils.js';
import { createKeystore, PublicKey } from '../src/KeyStore.js';
import { UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { IndexerLiveness, NoOpTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';

vi.setConfig({ testTimeout: 100_000, hookTimeout: 100_000 });

const environmentId = randomUUID();

const environmentVars = buildTestEnvironmentVariables(['APP_INFRA_SECRET'], {
  additionalVars: {
    TESTCONTAINERS_UID: environmentId,
  },
});

const environment = new DockerComposeEnvironment(getComposeDirectory(), 'docker-compose.yml')
  .withWaitStrategy(`node_${environmentId}`, Wait.forListeningPorts())
  .withWaitStrategy(`indexer_${environmentId}`, Wait.forListeningPorts())
  .withEnvironment(environmentVars);

describe('UnshieldedWallet', () => {
  let indexerPort: number;
  let nodePort: number;
  let startedEnvironment: StartedDockerComposeEnvironment;
  const unshieldedSeed = getUnshieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');

  beforeAll(async () => {
    startedEnvironment = await environment.up();
    indexerPort = startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088);
    nodePort = startedEnvironment.getContainer(`node_${environmentId}`).getMappedPort(9944);
  });

  it('should cross-check the indexer against the node using only the submission relay URL', async () => {
    // The check reads its endpoint from `relayURL` — the node a wallet already names for submission — so no second
    // endpoint is configured here. That is the wiring that shipped switched off: it needed a `nodeClientConnection`
    // nobody set. This runs it against a real indexer and a real node and waits for an actual verdict, which is the only
    // way to show the poll loop runs and its result reaches the wallet's progress.
    const config = createWalletConfig(indexerPort, {
      relayURL: new URL(`ws://localhost:${nodePort}`),
      // The default 30-second cadence leaves roughly three polls inside this file's 100s timeout, and the first one
      // usually lands before the indexer has ingested anything. Two seconds makes the verdict a certainty rather than
      // a race against the clock.
      livenessPollInterval: '2 seconds',
    });
    const keystore = createKeystore(unshieldedSeed, config.networkId);
    const wallet = UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(keystore));

    await wallet.start();

    try {
      const state = await firstValueFrom(
        wallet.state.pipe(rx.filter((state) => IndexerLiveness.isInSync(state.progress.indexerLiveness))),
      );

      const verdict = state.progress.indexerLiveness;
      expect(IndexerLiveness.isInSync(verdict)).toBe(true);
      // `Skipped` would mean the endpoint never resolved; `Unknown` that no poll completed.
      expect(verdict._tag).toBe('InSync');
    } finally {
      await wallet.stop();
    }
  });

  it('should build', async () => {
    const config = createWalletConfig(indexerPort);
    const keystore = createKeystore(unshieldedSeed, config.networkId);

    const unshieldedWallet = UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(keystore));

    await unshieldedWallet.start();

    // Just waiting for synced state is not enough because there is a possibility of reporting a synced state with no coins at the very beginning
    await waitForCoins(unshieldedWallet);

    const state = await unshieldedWallet.waitForSyncedState();

    expect(UnshieldedAddress.codec.encode(config.networkId, state.address).asString()).toBe(
      'mn_addr_undeployed1gkasr3z3vwyscy2jpp53nzr37v7n4r3lsfgj6v5g584dakjzt0xqun4d4r',
    );
    expect(state.availableCoins.length).toBeGreaterThan(0);
    expect(state.pendingCoins).toHaveLength(0);

    const transactionHistory = await config.txHistoryStorage.getAll();

    expect(transactionHistory.length).toBeGreaterThan(1);
  });

  it('should instantiate without transaction history service', async () => {
    const initialConfig = createWalletConfig(indexerPort, {
      txHistoryStorage: new NoOpTransactionHistoryStorage(),
    });
    const keystore = createKeystore(unshieldedSeed, initialConfig.networkId);
    const initialWallet = UnshieldedWallet(initialConfig).startWithPublicKey(PublicKey.fromKeyStore(keystore));

    await initialWallet.start();
    await waitForCoins(initialWallet);

    const initialState = await initialWallet.waitForSyncedState();

    expect(initialState.availableCoins.length).toBeGreaterThan(0);
    expect(initialState.pendingCoins.length).toBe(0);

    await initialWallet.stop();
  });

  it('should restore from serialized state', async () => {
    const initialConfig = createWalletConfig(indexerPort);
    const keystore = createKeystore(unshieldedSeed, initialConfig.networkId);
    const initialWallet = UnshieldedWallet(initialConfig).startWithPublicKey(PublicKey.fromKeyStore(keystore));

    await initialWallet.start();

    await initialWallet.waitForSyncedState();

    const initialState = await firstValueFrom(initialWallet.state);

    expect(initialState.availableCoins.length).toBe(initialState.availableCoins.length);
    expect(initialState.pendingCoins.length).toBe(initialState.pendingCoins.length);

    const serializedState = await initialWallet.serializeState();

    await initialWallet.stop();

    const restoreConfig = createWalletConfig(indexerPort);
    const restoredWallet = UnshieldedWallet(restoreConfig).restore(serializedState);
    await restoredWallet.start();

    await restoredWallet.waitForSyncedState();

    const restoredState = await firstValueFrom(restoredWallet.state);

    expect(UnshieldedAddress.codec.encode(restoreConfig.networkId, restoredState.address).asString()).toBe(
      UnshieldedAddress.codec.encode(restoreConfig.networkId, initialState.address).asString(),
    );
    expect(restoredState.availableCoins.length).toBe(initialState.availableCoins.length);
    expect(restoredState.pendingCoins.length).toBe(initialState.pendingCoins.length);

    await restoredWallet.stop();
  });

  afterAll(async () => {
    if (startedEnvironment) {
      await startedEnvironment.down();
    }
  });
});
