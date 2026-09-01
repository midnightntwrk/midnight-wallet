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
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UnshieldedWallet } from '../src/index.js';
import { getUnshieldedSeed, createWalletConfig, waitForCoins } from './testUtils.js';
import { createKeystore, PublicKey } from '../src/KeyStore.js';
import { UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { NoOpTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { type UtxoWithMeta } from '../src/v1/UnshieldedState.js';

vi.setConfig({ testTimeout: 100_000, hookTimeout: 100_000 });

const environmentId = randomUUID();
const NIGHT = ledger.nativeToken().raw;
const utxoHash = (coin: UtxoWithMeta): string => `${coin.utxo.intentHash}#${coin.utxo.outputNo}`;

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

  it('does not duplicate a booked utxo on replay, and restores it unbooked', async () => {
    // Reproduces the reported chain against a real node and indexer: book an input, never submit, restart from a
    // cursor that predates the input's creation so the indexer replays it, then sync.
    const config = createWalletConfig(indexerPort);
    const keystore = createKeystore(unshieldedSeed, config.networkId);
    const wallet = UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(keystore));
    await wallet.start();
    await waitForCoins(wallet);
    const funded = await wallet.waitForSyncedState();
    const fundedHashes = funded.availableCoins.map(utxoHash).sort();
    const fundedBalance = funded.balances[NIGHT] ?? 0n;
    expect(fundedHashes.length).toBeGreaterThan(0);

    // Balancing books the inputs. The transaction is then abandoned: not proved, not submitted, not reverted.
    const ownAddress = await wallet.getAddress();
    await wallet.transferTransaction(
      [{ amount: 1n, type: NIGHT, receiverAddress: ownAddress }],
      new Date(Date.now() + 60 * 60 * 1000),
    );
    const booked = await firstValueFrom(wallet.state);
    expect(booked.pendingCoins.length).toBeGreaterThan(0);

    const snapshot = await wallet.serializeState();
    await wallet.stop();

    // Restart from a cursor predating the inputs' creation, which makes the indexer replay the transactions that
    // created them -- the replay the guard in applyUpdate exists for.
    const rewound = JSON.stringify({ ...JSON.parse(snapshot), appliedId: '0' });
    const restored = UnshieldedWallet(createWalletConfig(indexerPort)).restore(rewound);

    // The invariant is checked on every state the wallet emits while it syncs, not only the last one: a duplicate that
    // appeared mid-sync and then collapsed would be invisible in the end state, and mid-sync is exactly when the
    // replayed creation of a coin arrives.
    const duplicatedMidSync: string[][] = [];
    const watch = restored.state.subscribe((s) => {
      const pendingNow = s.pendingCoins.map(utxoHash);
      const both = s.availableCoins.map(utxoHash).filter((h) => pendingNow.includes(h));
      if (both.length > 0) duplicatedMidSync.push(both);
    });

    await restored.start();
    const synced = await restored.waitForSyncedState();
    watch.unsubscribe();

    expect(duplicatedMidSync).toEqual([]);

    const available = synced.availableCoins.map(utxoHash);
    const pending = synced.pendingCoins.map(utxoHash);
    // A booking is not persisted (ADR 0008), so the abandoned one does not come back at all — there is nothing to
    // release and no window in which the coin is both booked and spendable.
    expect(pending).toEqual([]);
    expect(synced.bookings).toEqual([]);
    // And the wallet is back to exactly what it held, counted once.
    expect([...available].sort()).toEqual(fundedHashes);
    expect(synced.balances[NIGHT] ?? 0n).toEqual(fundedBalance);

    await restored.stop();
  });
});
