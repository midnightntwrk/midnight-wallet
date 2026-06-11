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
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import * as rx from 'rxjs';
import { existsSync } from 'node:fs';
import { exit } from 'node:process';
import * as fsAsync from 'node:fs/promises';
import * as ledger from '@midnight-ntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  type TransactionHistoryStorage,
} from '@midnight-ntwrk/wallet-sdk-abstractions';
import { ShieldedWallet, type ShieldedWalletClass } from '@midnight-ntwrk/wallet-sdk-shielded';
import { WalletFacade, WalletEntrySchema, mergeWalletEntries } from '@midnight-ntwrk/wallet-sdk-facade';
import {
  createKeystore,
  PublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { type DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-dust-wallet/v1';
import { type TestContainersFixture } from '../test-fixture.js';
import { logger } from '../logger.js';
import { getDustSeed, getShieldedSeed, getUnshieldedSeed } from './seeds.js';

export type WalletInit = {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
};

const waitForSyncProgress = async (wallet: WalletFacade) =>
  await rx.firstValueFrom(
    wallet.state().pipe(
      rx.throttleTime(5000),
      rx.tap((state) => {
        const applyGap = state.unshielded.progress.highestTransactionId - state.unshielded.progress.appliedId;
        logger.info(`Wallet facade behind by ${applyGap}`);
      }),
      rx.filter((state) => state.unshielded.progress.isStrictlyComplete()),
    ),
  );

const restoreShieldedWallet = async (
  path: string,
  Wallet: ShieldedWalletClass,
  readIfExists: (path: string) => Promise<string | undefined>,
) => {
  try {
    const serialized = await readIfExists(path);
    if (serialized) {
      const wallet = Wallet.restore(serialized);
      logger.info(`Restored shielded wallet from ${path}`);
      return wallet;
    }
    logger.warn('Unable to restore shielded wallet.');
  } catch (err: unknown) {
    logger.error(`Failed to restore shielded wallet: ${err instanceof Error ? err.message : String(err)}`);
  }
  return undefined;
};

const restoreUnshieldedWallet = async (
  path: string,
  seed: string,
  fixture: TestContainersFixture,
  readIfExists: (path: string) => Promise<string | undefined>,
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<TransactionHistoryStorage.TransactionHistoryEntryWithHash>,
) => {
  try {
    const serialized = await readIfExists(path);
    if (serialized) {
      const keyStore = createKeystore({ kind: 'schnorr', secret: getUnshieldedSeed(seed) }, fixture.getNetworkId());
      const wallet = UnshieldedWallet({
        networkId: fixture.getNetworkId(),
        indexerClientConnection: {
          indexerHttpUrl: fixture.getIndexerUri(),
          indexerWsUrl: fixture.getIndexerWsUri(),
        },
        txHistoryStorage,
      }).startWithPublicKey(PublicKey.fromKeyStore(keyStore));
      logger.info(`Restored unshielded wallet from ${path}`);
      return wallet;
    }
    logger.warn('Unable to restore unshielded wallet.');
  } catch (err: unknown) {
    logger.error(`Failed to restore unshielded wallet: ${err instanceof Error ? err.message : String(err)}`);
  }
  return undefined;
};

const restoreDustWallet = async (
  path: string,
  walletConfig: DefaultV1Configuration,
  readIfExists: (path: string) => Promise<string | undefined>,
) => {
  try {
    const serialized = await readIfExists(path);
    if (serialized) {
      const DustInstance = DustWallet({
        ...walletConfig,
        costParameters: walletConfig?.costParameters ?? {
          feeBlocksMargin: 5,
        },
      });
      const wallet = DustInstance.restore(serialized);
      logger.info(`Restored dust wallet from ${path}`);
      return wallet;
    }
    logger.warn('Unable to restore dust wallet.');
  } catch (err: unknown) {
    logger.error(`Failed to restore dust wallet: ${err instanceof Error ? err.message : String(err)}`);
  }
  return undefined;
};

export const provideWallet = async (
  filename: string,
  seed: string,
  fixture: TestContainersFixture,
): Promise<WalletInit> => {
  // Single shared tx-history storage so all three sub-wallets and the facade read/write
  // the same instance; otherwise shielded/unshielded writes go to a storage the facade
  // never queries.
  const txHistoryStorage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
  const walletConfig = { ...fixture.getWalletConfig(), txHistoryStorage };
  const dustWalletConfig = { ...fixture.getDustWalletConfig(), txHistoryStorage };
  const Wallet = ShieldedWallet(walletConfig);

  const directoryPath = process.env['SYNC_CACHE'];
  if (!directoryPath) {
    logger.warn('SYNC_CACHE env var not set');
    exit(1);
  }

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(getShieldedSeed(seed));
  const dustSecretKey = ledger.DustSecretKey.fromSeed(getDustSeed(seed));
  const unshieldedKeystore = createKeystore(
    { kind: 'schnorr', secret: getUnshieldedSeed(seed) },
    fixture.getNetworkId(),
  );

  const readIfExists = async (p: string): Promise<string | undefined> => {
    try {
      if (!existsSync(p)) return undefined;
      return await fsAsync.readFile(p, 'utf-8');
    } catch (err: unknown) {
      logger.error(`Failed to read ${p}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  };

  const [restoredShielded, restoredUnshielded, restoredDust] = await Promise.all([
    restoreShieldedWallet(`${directoryPath}/shielded-${filename}`, Wallet, readIfExists),
    restoreUnshieldedWallet(`${directoryPath}/unshielded-${filename}`, seed, fixture, readIfExists, txHistoryStorage),
    restoreDustWallet(`${directoryPath}/dust-${filename}`, { ...walletConfig, ...dustWalletConfig }, readIfExists),
  ]);

  if (!restoredShielded || !restoredUnshielded || !restoredDust) {
    logger.info('Building wallet facade from scratch');
    return initWalletWithSeed(seed, fixture);
  } else {
    const restoredWallet = await WalletFacade.init({
      configuration: {
        ...walletConfig,
        ...dustWalletConfig,
      },
      shielded: () => restoredShielded,
      unshielded: () => restoredUnshielded,
      dust: () => restoredDust,
    });
    await restoredWallet.start(shieldedSecretKeys, dustSecretKey);
    // check if wallet is syncing correctly
    await waitForSyncProgress(restoredWallet);
    const restoredWalletState = await rx.firstValueFrom(restoredWallet.state());
    const applyGap =
      restoredWalletState.unshielded.progress.highestTransactionId - restoredWalletState.unshielded.progress.appliedId;
    logger.info(`Apply gap: ${applyGap}`);
    if ((applyGap ?? 0) < 0) {
      logger.warn('Unable to sync restored wallet. Building wallet facade from scratch');
      await restoredWallet.stop();
      return initWalletWithSeed(seed, fixture);
    } else {
      logger.info('Successfully restored wallet facade.');
      return { wallet: restoredWallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
    }
  }
};

export const saveState = async (wallet: WalletFacade, filename: string) => {
  const directoryPath = process.env['SYNC_CACHE'];
  if (!directoryPath) {
    logger.warn('SYNC_CACHE env var not set');
    exit(1);
  }

  logger.info(`Saving state in ${directoryPath}/${filename}`);

  try {
    await fsAsync.mkdir(directoryPath, { recursive: true });

    // Serialize all three states
    const [shieldedSerializedState, unshieldedSerializedState, dustSerializedState] = await Promise.all([
      wallet.shielded.serializeState(),
      wallet.unshielded.serializeState(),
      wallet.dust.serializeState(),
    ]);

    const files = [
      { suffix: 'shielded-', data: shieldedSerializedState },
      { suffix: 'unshielded-', data: unshieldedSerializedState },
      { suffix: 'dust-', data: dustSerializedState },
    ];

    const results = await Promise.allSettled(
      files.map((f) => fsAsync.writeFile(`${directoryPath}/${f.suffix}${filename}`, f.data, 'utf-8')),
    );

    for (const [i, res] of results.entries()) {
      const pathWritten = `${directoryPath}/${files[i].suffix}${filename}`;
      if (res.status === 'fulfilled') {
        logger.info(`State written to file ${pathWritten}`);
      } else {
        logger.error(
          `Failed to write ${pathWritten}: ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`,
        );
      }
    }
  } catch (e) {
    if (typeof e === 'string') {
      logger.warn(e);
    } else if (e instanceof Error) {
      logger.warn(e.message);
    } else {
      logger.warn('Unknown error while saving state');
    }
  }
};

export const initWalletWithSeed = async (seed: string, fixture: TestContainersFixture): Promise<WalletInit> => {
  const walletConfig = fixture.getWalletConfig();
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(getShieldedSeed(seed));
  const dustSecretKey = ledger.DustSecretKey.fromSeed(getDustSeed(seed));
  const unshieldedKeystore = createKeystore(
    { kind: 'schnorr', secret: getUnshieldedSeed(seed) },
    fixture.getNetworkId(),
  );

  const facade: WalletFacade = await WalletFacade.init({
    configuration: {
      ...walletConfig,
      ...fixture.getDustWalletConfig(),
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    },
    shielded: (config) => ShieldedWallet(config).startWithSeed(getShieldedSeed(seed)),
    unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (config) =>
      DustWallet(config).startWithSeed(getDustSeed(seed), ledger.LedgerParameters.initialParameters().dust),
  });
  await facade.start(shieldedSecretKeys, dustSecretKey);
  return { wallet: facade, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};
