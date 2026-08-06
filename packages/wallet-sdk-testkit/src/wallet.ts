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

import * as rx from 'rxjs';
import { existsSync } from 'node:fs';
import * as fsAsync from 'node:fs/promises';
import * as ledger from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  type TransactionHistoryStorage,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { ShieldedWallet, type ShieldedWalletClass } from '@midnightntwrk/wallet-sdk-shielded';
import { WalletFacade, WalletEntrySchema, mergeWalletEntries } from '@midnightntwrk/wallet-sdk-facade';
import {
  createKeystore,
  PublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { type DefaultDustConfiguration, DustWallet, type DustWalletClass } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { type DefaultV1Configuration } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import { type WalletTestEnvironment } from './types.js';
import { logger } from './logger.js';
import { getDustSeed, getShieldedSeed, getUnshieldedSeed } from './seeds.js';

export type WalletInit = {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
};

/** Options for {@link provideWallet}. */
export interface ProvideWalletOptions {
  /** Hex seed used to derive the three sub-wallet keys. */
  seed: string;
  /**
   * Directory used to persist/restore serialized wallet state across runs. When omitted, the wallet is always built
   * from scratch and nothing is read or written (replaces the old `SYNC_CACHE` env var, which `exit(1)`-ed when unset).
   * Explicitly allows `undefined` for pass-through under `exactOptionalPropertyTypes`.
   */
  syncCacheDir?: string | undefined;
  /** Filename suffix for the three serialized state files. Required when `syncCacheDir` is set. */
  filename?: string | undefined;
  /**
   * Replaces the dust sub-wallet factory. Defaults to the event-based `DustWallet`; supply a factory built with
   * `makeEventLessSyncService` to exercise the projections-based sync instead. Applies to both the restored and the
   * built-from-scratch paths, so a cold cache cannot silently fall back to a different sync model.
   */
  dustWallet?: ((config: DefaultDustConfiguration) => DustWalletClass) | undefined;
  /**
   * Starts the facade without background syncing, leaving the caller to drive `facade.doSync()`. Defaults to `false`
   * (background sync), which is what every existing scenario relies on.
   */
  manualSync?: boolean | undefined;
}

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
  env: WalletTestEnvironment,
  readIfExists: (path: string) => Promise<string | undefined>,
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<TransactionHistoryStorage.TransactionHistoryEntryWithHash>,
) => {
  try {
    const serialized = await readIfExists(path);
    if (serialized) {
      const keyStore = createKeystore({ kind: 'schnorr', secret: getUnshieldedSeed(seed) }, env.endpoints.networkId);
      const wallet = UnshieldedWallet({
        networkId: env.endpoints.networkId,
        indexerClientConnection: {
          indexerHttpUrl: env.endpoints.indexerHttpUrl,
          indexerWsUrl: env.endpoints.indexerWsUrl,
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
  dustWallet: (config: DefaultDustConfiguration) => DustWalletClass = DustWallet,
) => {
  try {
    const serialized = await readIfExists(path);
    if (serialized) {
      const DustInstance = dustWallet({
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

/**
 * Builds a fully-started {@link WalletFacade} (shielded + unshielded + dust) for the given seed.
 *
 * If `syncCacheDir`/`filename` are provided, attempts to restore serialized state from disk and verify it syncs;
 * otherwise (or on any restore failure) builds from scratch via {@link initWalletWithSeed}.
 */
export const provideWallet = async (env: WalletTestEnvironment, options: ProvideWalletOptions): Promise<WalletInit> => {
  const { seed, syncCacheDir, filename, dustWallet, manualSync } = options;
  const fromScratch = { dustWallet, manualSync };

  if (!syncCacheDir || !filename) {
    logger.info('No sync cache configured; building wallet facade from scratch');
    return initWalletWithSeed(env, seed, fromScratch);
  }

  // Single shared tx-history storage so all three sub-wallets and the facade read/write
  // the same instance; otherwise shielded/unshielded writes go to a storage the facade
  // never queries.
  const txHistoryStorage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
  const walletConfig = { ...env.getWalletConfig(), txHistoryStorage };
  const dustWalletConfig = { ...env.getDustWalletConfig(), txHistoryStorage };
  const Wallet = ShieldedWallet(walletConfig);

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(getShieldedSeed(seed));
  const dustSecretKey = ledger.DustSecretKey.fromSeed(getDustSeed(seed));
  const unshieldedKeystore = createKeystore(
    { kind: 'schnorr', secret: getUnshieldedSeed(seed) },
    env.endpoints.networkId,
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
    restoreShieldedWallet(`${syncCacheDir}/shielded-${filename}`, Wallet, readIfExists),
    restoreUnshieldedWallet(`${syncCacheDir}/unshielded-${filename}`, seed, env, readIfExists, txHistoryStorage),
    restoreDustWallet(
      `${syncCacheDir}/dust-${filename}`,
      { ...walletConfig, ...dustWalletConfig },
      readIfExists,
      dustWallet,
    ),
  ]);

  if (!restoredShielded || !restoredUnshielded || !restoredDust) {
    logger.info('Building wallet facade from scratch');
    return initWalletWithSeed(env, seed, fromScratch);
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
    await restoredWallet.start(shieldedSecretKeys, dustSecretKey, manualSync ?? false);
    // check if wallet is syncing correctly
    await waitForSyncProgress(restoredWallet);
    const restoredWalletState = await rx.firstValueFrom(restoredWallet.state());
    const applyGap =
      restoredWalletState.unshielded.progress.highestTransactionId - restoredWalletState.unshielded.progress.appliedId;
    logger.info(`Apply gap: ${applyGap}`);
    if ((applyGap ?? 0) < 0) {
      logger.warn('Unable to sync restored wallet. Building wallet facade from scratch');
      await restoredWallet.stop();
      return initWalletWithSeed(env, seed);
    } else {
      logger.info('Successfully restored wallet facade.');
      return { wallet: restoredWallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
    }
  }
};

/**
 * Whether the test that has just finished is safe to persist wallet state from.
 *
 * State written by a failed or timed-out test is worse than no state at all: the next run restores it, resumes from
 * whatever partial position the failure left behind, and fails in turn — so one transient failure becomes permanent and
 * every later run inherits it. Only a test that passed is known to have left its wallets in a position the chain can be
 * resumed from.
 *
 * Pass the `afterEach` context: `afterEach((ctx) => { if (shouldPersistState(ctx)) await saveState(...) })`.
 */
export const shouldPersistState = (context: {
  readonly task: { readonly result?: { readonly state?: string } };
}): boolean => context.task.result?.state === 'pass';

/** Serializes all three sub-wallet states into `syncCacheDir`, keyed by `filename`. */
export const saveState = async (wallet: WalletFacade, syncCacheDir: string, filename: string): Promise<void> => {
  logger.info(`Saving state in ${syncCacheDir}/${filename}`);

  try {
    await fsAsync.mkdir(syncCacheDir, { recursive: true });

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
      files.map((f) => fsAsync.writeFile(`${syncCacheDir}/${f.suffix}${filename}`, f.data, 'utf-8')),
    );

    for (const [i, res] of results.entries()) {
      const pathWritten = `${syncCacheDir}/${files[i].suffix}${filename}`;
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

/** Options for {@link initWalletWithSeed}, a subset of {@link ProvideWalletOptions}. */
export type InitWalletOptions = Pick<ProvideWalletOptions, 'dustWallet' | 'manualSync'>;

/** Builds and starts a fresh {@link WalletFacade} from `seed`, with no disk persistence. */
export const initWalletWithSeed = async (
  env: WalletTestEnvironment,
  seed: string,
  options: InitWalletOptions = {},
): Promise<WalletInit> => {
  const dustWalletClass = options.dustWallet ?? DustWallet;
  const walletConfig = env.getWalletConfig();
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(getShieldedSeed(seed));
  const dustSecretKey = ledger.DustSecretKey.fromSeed(getDustSeed(seed));
  const unshieldedKeystore = createKeystore(
    { kind: 'schnorr', secret: getUnshieldedSeed(seed) },
    env.endpoints.networkId,
  );

  const facade: WalletFacade = await WalletFacade.init({
    configuration: {
      ...walletConfig,
      ...env.getDustWalletConfig(),
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    },
    shielded: (config) => ShieldedWallet(config).startWithSeed(getShieldedSeed(seed)),
    unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (config) =>
      dustWalletClass(config).startWithSeed(getDustSeed(seed), ledger.LedgerParameters.initialParameters().dust),
  });
  await facade.start(shieldedSecretKeys, dustSecretKey, options.manualSync ?? false);
  return { wallet: facade, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};
