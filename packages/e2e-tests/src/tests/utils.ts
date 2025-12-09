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
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { filter, firstValueFrom, tap, throttleTime } from 'rxjs';
import { WalletState, type Wallet } from '@midnight-ntwrk/wallet-api';
import { logger } from './logger.js';
import { TestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { existsSync } from 'node:fs';
import { exit } from 'node:process';
import * as fsAsync from 'node:fs/promises';
import * as fs from 'node:fs';
import { ShieldedWallet, ShieldedWalletClass, ShieldedWalletState } from '@midnight-ntwrk/wallet-sdk-shielded';
import { ShieldedAddress, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DefaultV1Configuration, DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';

// place this somewhere better?
export const Segments = {
  guaranteed: 0,
  fallible: 1,
};

export const waitForSyncProgress = async (wallet: WalletFacade) =>
  await firstValueFrom(
    wallet.state().pipe(
      throttleTime(5000),
      tap((state) => {
        const applyGap = state.unshielded.progress.highestTransactionId - state.unshielded.progress.appliedId;
        logger.info(`Wallet facade behind by ${applyGap}`);
      }),
      filter((state) =>
        // Let's allow progress only if syncProgress is defined
        state.unshielded.progress.isStrictlyComplete(),
      ),
    ),
  );

export const isAnotherChain = async (wallet: ShieldedWallet, offset: number) => {
  const state = await wallet.waitForSyncedState();
  // allow for situations when there's no new index in the network between runs
  const applyGap = state.state?.progress.highestRelevantIndex - state.state?.progress.appliedIndex;
  return applyGap <= offset - 1;
};

export const streamToString = async (stream: fs.ReadStream): Promise<string> => {
  const chunks: string[] = [];
  return await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk as string));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(chunks.join('')));
  });
};

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
) => {
  try {
    const serialized = await readIfExists(path);
    if (serialized) {
      logger.info(`Unshielded serialize: ${serialized}`);
      const keyStore = createKeystore(getUnshieldedSeed(seed), fixture.getNetworkId());
      const wallet = UnshieldedWallet({
        networkId: fixture.getNetworkId(),
        indexerClientConnection: {
          indexerHttpUrl: fixture.getIndexerUri(),
          indexerWsUrl: fixture.getIndexerWsUri(),
        },
        txHistoryStorage: new InMemoryTransactionHistoryStorage(),
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
      logger.info(`Dust serialize: ${serialized}`);
      const DustInstance = DustWallet({
        ...walletConfig,
        costParameters: walletConfig?.costParameters ?? {
          additionalFeeOverhead: 300_000_000_000_000n,
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
): Promise<WalletFacade> => {
  const walletConfig = fixture.getWalletConfig();
  const dustWalletConfig = fixture.getDustWalletConfig();
  const Wallet = ShieldedWallet(walletConfig);
  const directoryPath = process.env['SYNC_CACHE'];
  if (!directoryPath) {
    logger.warn('SYNC_CACHE env var not set');
    exit(1);
  }

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
    restoreUnshieldedWallet(`${directoryPath}/unshielded-${filename}`, seed, fixture, readIfExists),
    restoreDustWallet(`${directoryPath}/dust-${filename}`, dustWalletConfig, readIfExists),
  ]);

  if (!restoredShielded || !restoredUnshielded || !restoredDust) {
    logger.info('Building wallet facade from scratch');
    return buildWalletFacade(seed, fixture);
  } else {
    const restoredWallet = new WalletFacade(restoredShielded, restoredUnshielded, restoredDust);
    // check if wallet is syncing correctly
    await waitForSyncProgress(restoredWallet);
    const restoredWalletState = await firstValueFrom(restoredWallet.state());
    const applyGap =
      restoredWalletState.unshielded.progress.highestTransactionId - restoredWalletState.unshielded.progress.appliedId;
    logger.info(`Apply gap: ${applyGap}`);
    if ((applyGap ?? 0) < 0) {
      logger.warn('Unable to sync restored wallet. Building wallet facade from scratch');
      return buildWalletFacade(seed, fixture);
    } else {
      logger.info('Successfully restored wallet facade.');
      return restoredWallet;
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

export const buildWalletFacade = (walletSeed: string, fixture: TestContainersFixture) => {
  const unshieldedKeyStore = createKeystore(getUnshieldedSeed(walletSeed), fixture.getNetworkId());
  const Wallet = ShieldedWallet(fixture.getWalletConfig());

  const shieldedWallet = Wallet.startWithShieldedSeed(getShieldedSeed(walletSeed));

  const unshieldedWallet = UnshieldedWallet({
    networkId: fixture.getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: fixture.getIndexerUri(),
      indexerWsUrl: fixture.getIndexerWsUri(),
    },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeyStore));

  const dustSeed = getDustSeed(walletSeed);
  const Dust = DustWallet(fixture.getDustWalletConfig());
  const dustParameters = new ledger.DustParameters(5_000_000_000n, 8267n, 3n * 60n * 60n);
  const dustWallet = Dust.startWithSeed(dustSeed, dustParameters);

  return new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
};

export const closeWallet = async (wallet: WalletFacade) => {
  try {
    await wallet.stop();
  } catch (e: unknown) {
    if (typeof e === 'string') {
      logger.warn(e);
    } else if (e instanceof Error) {
      logger.warn(e.message);
    }
  }
};

export const waitForSyncUnshielded = (wallet: UnshieldedWallet) =>
  firstValueFrom(
    wallet.state.pipe(
      throttleTime(5_000),
      tap((state) => {
        const applyGap = state.state.progress.highestTransactionId - state.state.progress.appliedId;
        // const txs = state.transactionHistory.length;
        logger.info(`Wallet behind by ${applyGap} indices`);
      }),
      filter((state) => state.state.progress.isStrictlyComplete()),
    ),
  );

export const waitForSyncShielded = (wallet: ShieldedWallet) =>
  firstValueFrom(
    wallet.state.pipe(
      throttleTime(5_000),
      tap((state) => {
        const applyGap = state.state?.progress.highestRelevantIndex - state.state?.progress.appliedIndex;
        const sourceGap = state.state?.progress.highestIndex - state.state?.progress.highestRelevantIndex;
        // const txs = state.transactionHistory.length;
        logger.info(
          `Wallet behind by ${applyGap} indices, source behind by ${sourceGap}, synced = ${state.state?.progress.isStrictlyComplete()}`,
        );
      }),
      filter(
        (state) =>
          state.state?.progress !== undefined &&
          state.state?.progress.highestRelevantIndex - state.state?.progress.appliedIndex === 0n &&
          state.state?.progress.highestIndex - state.state?.progress.highestRelevantIndex <= 50n &&
          state.state?.progress.isStrictlyComplete() === true,
      ),
    ),
  );

export const waitForSyncOld = (wallet: Wallet) =>
  firstValueFrom(
    wallet.state().pipe(
      throttleTime(5_000),
      tap((state) => {
        const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
        const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
        const txs = state.transactionHistory.length;
        logger.info(`Wallet behind by ${applyGap} indices, source behind by ${sourceGap}, transactions=${txs}`);
      }),
      filter(
        (state) =>
          state.syncProgress !== undefined &&
          state?.syncProgress?.lag?.applyGap === 0n &&
          state?.syncProgress?.lag?.sourceGap <= 100n,
      ),
    ),
  );

export const waitForSyncFacade = async (facade: WalletFacade) =>
  await firstValueFrom(
    facade.state().pipe(
      throttleTime(5_000),
      tap((state) => {
        const applyGap = state.unshielded.progress.highestTransactionId - state.unshielded.progress.appliedId;
        logger.info(`Wallet facade behind by ${applyGap}`);
      }),
      filter(
        (state) =>
          state.dust.state.progress.isStrictlyComplete() &&
          state.shielded.state.progress.isStrictlyComplete() &&
          state.unshielded.progress.isStrictlyComplete(),
      ),
    ),
  );

export const waitForFacadePending = (wallet: WalletFacade) =>
  firstValueFrom(
    wallet.state().pipe(
      tap((state) => {
        const shieldedPending = state.shielded.pendingCoins.length;
        logger.info(`Shielded wallet pending coins: ${shieldedPending}, waiting for pending coins...`);
        const unshieldedPending = state.shielded.pendingCoins.length;
        logger.info(`Unshielded wallet pending coins: ${unshieldedPending}, waiting for pending coins...`);
      }),
      filter(
        (state) =>
          // Let's allow progress only if pendingCoins are present
          state.shielded.pendingCoins.length > 0 || state.unshielded.pendingCoins.length > 0,
      ),
    ),
  );

export const waitForFacadePendingClear = (wallet: WalletFacade) =>
  firstValueFrom(
    wallet.state().pipe(
      tap((state) => {
        const shieldedPending = state.shielded.pendingCoins.length;
        logger.info(`Shielded wallet pending coins: ${shieldedPending}, waiting for pending coins to clear...`);
        const unshieldedPending = state.unshielded.pendingCoins.length;
        logger.info(`Unshielded wallet pending coins: ${unshieldedPending}, waiting for pending coins to clear...`);
        const dustPending = state.dust.pendingCoins.length;
        logger.info(`Dust wallet pending coins: ${dustPending}, waiting for pending coins to clear...`);
      }),
      filter(
        (state) =>
          // Allow progress only if there are no pending coins
          state.shielded.pendingCoins.length == 0 &&
          state.unshielded.pendingCoins.length == 0 &&
          state.dust.pendingCoins.length == 0,
      ),
    ),
  );

export const waitForPending = (wallet: ShieldedWallet) =>
  firstValueFrom(
    wallet.state.pipe(
      tap((state) => {
        const pending = state.pendingCoins.length;
        logger.info(`Wallet pending coins: ${pending}, waiting for pending coins...`);
      }),
      filter((state) => {
        // Let's allow progress only if pendingCoins are present
        const pending = state.pendingCoins.length;
        return pending > 0;
      }),
    ),
  );

export const waitForBalanceUpdate = (wallet: UnshieldedWallet) =>
  firstValueFrom(
    wallet.state.pipe(
      tap((state) => {
        const balanceSize = Object.values(state.balances).length;
        logger.info(`Balance size: ${balanceSize}, waiting for balance to update...`);
      }),
      filter((state) => {
        return Object.values(state.balances).length > 0;
      }),
    ),
  );

export const waitForDustBalance = (wallet: WalletFacade, expectedDustBalance: bigint) =>
  firstValueFrom(
    wallet.state().pipe(
      tap((state) => {
        const dustBalance = state.dust.walletBalance(new Date(Date.now() + 60 * 60 * 1000));
        logger.info(`Dust balance: ${dustBalance}`);
      }),
      filter((state) => {
        return state.dust.walletBalance(new Date(Date.now() + 60 * 60 * 1000)) >= expectedDustBalance;
      }),
    ),
  );

export const waitForFinalizedBalanceUnshielded = (wallet: UnshieldedWallet) =>
  firstValueFrom(
    wallet.state.pipe(
      tap((state) => {
        const pending = state.pendingCoins.length;
        logger.info(`Wallet pending coins: ${pending}, waiting for pending coins cleared...`);
      }),
      filter((state) => {
        // Let's allow progress only if pendingCoins are cleared
        const pending = state.pendingCoins.length;
        return pending === 0;
      }),
    ),
  );

export const waitForFinalizedBalance = (wallet: ShieldedWallet) =>
  firstValueFrom(
    wallet.state.pipe(
      tap((state) => {
        const pending = state.pendingCoins.length;
        logger.info(`Wallet pending coins: ${pending}, waiting for pending coins cleared...`);
      }),
      filter((state) => {
        // Let's allow progress only if pendingCoins are cleared
        const pending = state.pendingCoins.length;
        return pending === 0;
      }),
    ),
  );

// export const waitForTxInHistory = async (txId: string, wallet: ShieldedWallet) =>
//   firstValueFrom(
//     wallet.state.pipe(
//       tap({
//         next: (state) => {
//           logger.info(`Current transactionHistory: ${state.transactionHistory}`);
//           state.transactionHistory.forEach((tx, idx) => {
//             logger.info(`Tx[${idx}] identifiers: ${JSON.stringify(tx.identifiers())}`);
//           });
//           const txFound = state.transactionHistory.some((tx) => tx.identifiers().includes(txId));
//           logger.info(`Transaction ${txId} found: ${txFound}`);
//         },
//       }),
//       filter((state) => state.transactionHistory.some((tx) => tx.identifiers().includes(txId))),
//     ),
//   );

// export const walletStateTrimmed = (state: ShieldedWalletState) => {
//   const { totalCoins, availableCoins, ...rest } = state; // eslint-disable-line @typescript-eslint/no-unused-vars
//   return rest;
// };

// export function normalizeWalletState(state: ShieldedWalletState) {
//   const normalized = state.transactionHistory.map((txHistoryEntry: Transaction) => {
//     const { identifiers, ...otherProps } = txHistoryEntry; // eslint-disable-line @typescript-eslint/no-unused-vars
//     return otherProps;
//   });
//   const { transactionHistory, syncProgress, ...otherProps } = state; // eslint-disable-line @typescript-eslint/no-unused-vars
//   return { ...otherProps, normalized };
// }

export const getTransactionHistoryIds = (state: ShieldedWalletState) => {
  return state.transactionHistory.map((tx) => tx.identifiers());
};

// export function compareStates(state1: ShieldedWalletState, state2: ShieldedWalletState) {
//   const normalized1 = normalizeWalletState(state1);
//   const normalized2 = normalizeWalletState(state2);
//   expect(normalized1).toStrictEqual(normalized2);
// }

// Validate wallet transaction history after wallet has received token
export function validateWalletTxHistory(finalWalletState: WalletState, initialWalletState: WalletState) {
  expect(finalWalletState.availableCoins.length).toBe(initialWalletState.availableCoins.length + 1);
  expect(finalWalletState.pendingCoins.length).toBe(0);
  expect(finalWalletState.coins.length).toBeGreaterThanOrEqual(initialWalletState.coins.length + 1);
  expect(finalWalletState.nullifiers.length).toBeGreaterThanOrEqual(initialWalletState.nullifiers.length + 1);
  expect(finalWalletState.transactionHistory.length).toBeGreaterThanOrEqual(
    initialWalletState.transactionHistory.length + 1,
  );
}

export function validateNetworkInAddress(address: string) {
  switch (TestContainersFixture.network) {
    case 'testnet':
      expect(address).toContain('test');
      break;
    case 'devnet':
      expect(address).toContain('dev');
      break;
    case 'undeployed':
      expect(address).toContain('undeployed');
      break;
  }
}

export function getShieldedAddress(networkId: NetworkId.NetworkId, walletAddress: ShieldedAddress): string {
  return ShieldedAddress.codec.encode(networkId, walletAddress).asString();
}

export function getUnshieldedAddress(networkId: NetworkId.NetworkId, walletAddress: UnshieldedAddress): string {
  return UnshieldedAddress.codec.encode(networkId, walletAddress).asString();
}

export const getShieldedSeed = (seed: string): Uint8Array => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.Zswap).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return Buffer.from(derivationResult.key);
};

export const getUnshieldedSeed = (seed: string): Uint8Array<ArrayBufferLike> => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return derivationResult.key;
};

export const getDustSeed = (seed: string): Uint8Array<ArrayBufferLike> => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.Dust).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return derivationResult.key;
};

export const isArrayUnique = (arr: any[]) => Array.isArray(arr) && new Set(arr).size === arr.length; // eslint-disable-line @typescript-eslint/no-explicit-any

export type MidnightNetwork = 'undeployed' | 'node-dev-01' | 'qanet' | 'devnet' | 'testnet' | 'preview' | 'preprod';
