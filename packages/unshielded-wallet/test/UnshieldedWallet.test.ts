// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UnshieldedWallet } from '../src/index.js';
import { getUnshieldedSeed, createWalletConfig, waitForCoins } from './testUtils.js';
import { createKeystore, PublicKey } from '../src/KeyStore.js';
import { InMemoryTransactionHistoryStorage, NoOpTransactionHistoryStorage } from '../src/storage/index.js';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

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
  let startedEnvironment: StartedDockerComposeEnvironment;
  const unshieldedSeed = getUnshieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');

  beforeAll(async () => {
    startedEnvironment = await environment.up();
    indexerPort = startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088);
  });

  it('should build', async () => {
    const txHistoryStorage = new InMemoryTransactionHistoryStorage();
    const config = createWalletConfig(indexerPort, { txHistoryStorage });
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

    const transactionHistory = await Array.fromAsync(state.transactionHistory.getAll());

    expect(transactionHistory.length).toBeGreaterThan(1);
  });

  it('should restore from serialized state with tx history', async () => {
    const txHistoryStorage = new InMemoryTransactionHistoryStorage();
    const initialConfig = createWalletConfig(indexerPort, { txHistoryStorage });
    const keystore = createKeystore(unshieldedSeed, initialConfig.networkId);

    const initialWallet = UnshieldedWallet(initialConfig).startWithPublicKey(PublicKey.fromKeyStore(keystore));

    await initialWallet.start();

    await waitForCoins(initialWallet);

    const initialState = await initialWallet.waitForSyncedState();

    expect(initialState.availableCoins.length).toBeGreaterThan(0);
    expect(initialState.pendingCoins.length).toBe(0);

    const serializedState = await initialWallet.serializeState();

    const serializedTxHistory = txHistoryStorage.serialize();

    await initialWallet.stop();

    const restoredTxHistoryStorage = InMemoryTransactionHistoryStorage.fromSerialized(serializedTxHistory);

    const restoredConfig = createWalletConfig(indexerPort, { txHistoryStorage: restoredTxHistoryStorage });

    const restoredWallet = UnshieldedWallet(restoredConfig).restore(serializedState);

    await restoredWallet.start();

    await restoredWallet.waitForSyncedState();

    const restoredState = await firstValueFrom(restoredWallet.state);

    expect(UnshieldedAddress.codec.encode(initialConfig.networkId, restoredState.address).asString()).toBe(
      UnshieldedAddress.codec.encode(initialConfig.networkId, initialState.address).asString(),
    );
    expect(restoredState.availableCoins.length).toBe(initialState.availableCoins.length);
    expect(restoredState.pendingCoins.length).toBe(initialState.pendingCoins.length);

    await restoredWallet.stop();
  });

  it('should instantiate without transaction history service', async () => {
    const initialConfig = createWalletConfig(indexerPort, { txHistoryStorage: new NoOpTransactionHistoryStorage() });
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
    const txHistoryStorage = new InMemoryTransactionHistoryStorage();
    const initialConfig = createWalletConfig(indexerPort, {
      txHistoryStorage,
    });
    const keystore = createKeystore(unshieldedSeed, initialConfig.networkId);
    const initialWallet = UnshieldedWallet(initialConfig).startWithPublicKey(PublicKey.fromKeyStore(keystore));

    await initialWallet.start();

    await initialWallet.waitForSyncedState();

    const initialState = await firstValueFrom(initialWallet.state);

    expect(initialState.availableCoins.length).toBe(initialState.availableCoins.length);
    expect(initialState.pendingCoins.length).toBe(initialState.pendingCoins.length);

    const serializedState = await initialWallet.serializeState();

    await initialWallet.stop();

    const restoreConfig = createWalletConfig(indexerPort, { txHistoryStorage });
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
