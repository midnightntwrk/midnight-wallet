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
import {
  ShieldedWallet,
  type ShieldedWalletClass,
  type ShieldedWalletState,
} from '@midnight-ntwrk/wallet-sdk-shielded';
import { UnshieldedWallet, createKeystore, PublicKey } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { type DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { type DefaultV1Configuration as UnshieldedV1Configuration } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet/v1';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment } from 'testcontainers';
import { firstValueFrom } from 'rxjs';
import * as rx from 'rxjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShieldedSeed, getUnshieldedSeed } from './utils.js';
import { InMemoryTransactionHistoryStorage, NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { WalletEntrySchema } from '@midnight-ntwrk/wallet-sdk-facade';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const environmentId = randomUUID();

const environmentVars = buildTestEnvironmentVariables(['APP_INFRA_SECRET'], {
  additionalVars: {
    TESTCONTAINERS_UID: environmentId,
    RAYON_NUM_THREADS: Math.min(os.availableParallelism(), 32).toString(10),
  },
});

const environment = new DockerComposeEnvironment(getComposeDirectory(), 'docker-compose-dynamic.yml').withEnvironment(
  environmentVars,
);

describe('Wallet serialization and restoration', () => {
  let startedEnvironment: StartedDockerComposeEnvironment;
  let shieldedConfiguration: DefaultV1Configuration;
  let unshieldedConfiguration: UnshieldedV1Configuration;
  let indexerPort: number;

  beforeAll(async () => {
    startedEnvironment = await environment.up();
    indexerPort = startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088);

    shieldedConfiguration = {
      indexerClientConnection: {
        indexerHttpUrl: `http://localhost:${indexerPort}/api/v4/graphql`,
      },
      networkId: NetworkId.NetworkId.Undeployed,
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
    };

    unshieldedConfiguration = {
      indexerClientConnection: {
        indexerWsUrl: `ws://localhost:${indexerPort}/api/v4/graphql/ws`,
        indexerHttpUrl: `http://localhost:${indexerPort}/api/v4/graphql`,
      },
      networkId: NetworkId.NetworkId.Undeployed,
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
    };
  });

  afterAll(async () => {
    await startedEnvironment?.down({ timeout: 10_000 });
  });

  let Wallet: ShieldedWalletClass;
  beforeEach(() => {
    Wallet = ShieldedWallet(shieldedConfiguration);
  });

  it('allows to restore an non-empty wallet from the serialized state', async () => {
    const seed = getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');
    const wallet = Wallet.startWithSeed(seed);
    await wallet.start(ledger.ZswapSecretKeys.fromSeed(seed));
    try {
      const syncedState: ShieldedWalletState = await wallet.waitForSyncedState();
      const originalBalances = syncedState.balances;

      const serializedState = await wallet.serializeState();
      const restored = Wallet.restore(serializedState);
      await restored.start(ledger.ZswapSecretKeys.fromSeed(seed));
      try {
        const state = await restored.waitForSyncedState();
        const restoredBalances = state.balances;

        expect(originalBalances).not.toEqual({});
        expect(restoredBalances).toEqual(originalBalances);
      } finally {
        await restored.stop();
      }
    } finally {
      await wallet.stop();
    }
  });

  it('allows to restore an empty wallet from the serialized state', async () => {
    const seed = getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000009');
    const wallet = Wallet.startWithSeed(seed);
    await wallet.start(ledger.ZswapSecretKeys.fromSeed(seed));
    try {
      const syncedState: ShieldedWalletState = await wallet.waitForSyncedState();
      const originalBalances = syncedState.balances;

      const serializedState = await wallet.serializeState();
      const restored = Wallet.restore(serializedState);
      await restored.start(ledger.ZswapSecretKeys.fromSeed(seed));
      try {
        const state = await restored.waitForSyncedState();
        const restoredBalances = state.balances;

        expect(originalBalances).toEqual({});
        expect(restoredBalances).toEqual(originalBalances);
      } finally {
        await restored.stop();
      }
    } finally {
      await wallet.stop();
    }
  });

  it('should restore shielded wallet from serialized transaction history', async () => {
    const seed = getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');
    const wallet = ShieldedWallet(shieldedConfiguration).startWithSeed(seed);
    await wallet.start(ledger.ZswapSecretKeys.fromSeed(seed));
    try {
      await wallet.waitForSyncedState();

      const initialTxHistory = await Array.fromAsync(shieldedConfiguration.txHistoryStorage.getAll());
      const serializedTxHistory = await shieldedConfiguration.txHistoryStorage.serialize();
      const serializedState = await wallet.serializeState();
      await wallet.stop();

      const restoredTxHistoryStorage = InMemoryTransactionHistoryStorage.restore(
        serializedTxHistory,
        WalletEntrySchema,
      );
      const restoredWallet = ShieldedWallet({
        ...shieldedConfiguration,
        txHistoryStorage: restoredTxHistoryStorage,
      }).restore(serializedState);

      await restoredWallet.start(ledger.ZswapSecretKeys.fromSeed(seed));
      try {
        await restoredWallet.waitForSyncedState();

        const restoredTxHistory = await Array.fromAsync(restoredTxHistoryStorage.getAll());

        expect(restoredTxHistory).toEqual(initialTxHistory);
      } finally {
        await restoredWallet.stop();
      }
    } finally {
      await wallet.stop().catch(() => {});
    }
  });

  it('should restore unshielded wallet from serialized transaction history', async () => {
    const unshieldedSeed = getUnshieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');
    const keystore = createKeystore(unshieldedSeed, unshieldedConfiguration.networkId);

    const initialWallet = UnshieldedWallet(unshieldedConfiguration).startWithPublicKey(
      PublicKey.fromKeyStore(keystore),
    );
    await initialWallet.start();
    try {
      await firstValueFrom(initialWallet.state.pipe(rx.filter((state) => state.availableCoins.length > 0)));
      await initialWallet.waitForSyncedState();

      const initialTxHistory = await Array.fromAsync(unshieldedConfiguration.txHistoryStorage.getAll());
      const serializedTxHistory = await unshieldedConfiguration.txHistoryStorage.serialize();
      const serializedState = await initialWallet.serializeState();
      await initialWallet.stop();

      const restoredTxHistoryStorage = InMemoryTransactionHistoryStorage.restore(
        serializedTxHistory,
        WalletEntrySchema,
      );
      const restoredWallet = UnshieldedWallet({
        ...unshieldedConfiguration,
        txHistoryStorage: restoredTxHistoryStorage,
      }).restore(serializedState);

      await restoredWallet.start();
      try {
        await restoredWallet.waitForSyncedState();

        const restoredTxHistory = await Array.fromAsync(restoredTxHistoryStorage.getAll());

        expect(restoredTxHistory).toEqual(initialTxHistory);
      } finally {
        await restoredWallet.stop();
      }
    } finally {
      await initialWallet.stop().catch(() => {});
    }
  });
});
