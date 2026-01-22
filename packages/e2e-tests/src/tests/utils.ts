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
import * as rx from 'rxjs';
import { logger } from './logger.js';
import { TestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v7';
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
  UnshieldedKeystore,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DefaultV1Configuration, DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';

// place this somewhere better?
export const Segments = {
  guaranteed: 0,
  fallible: 1,
};

export type WalletInit = {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
};

export const waitForSyncProgress = async (wallet: WalletFacade) =>
  await rx.firstValueFrom(
    wallet.state().pipe(
      rx.throttleTime(5000),
      rx.tap((state) => {
        const applyGap = state.unshielded.progress.highestTransactionId - state.unshielded.progress.appliedId;
        logger.info(`Wallet facade behind by ${applyGap}`);
      }),
      rx.filter((state) =>
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
): Promise<WalletInit> => {
  const walletConfig = fixture.getWalletConfig();
  const dustWalletConfig = fixture.getDustWalletConfig();
  const Wallet = ShieldedWallet(walletConfig);
  const directoryPath = process.env['SYNC_CACHE'];
  if (!directoryPath) {
    logger.warn('SYNC_CACHE env var not set');
    exit(1);
  }

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(getShieldedSeed(seed));
  const dustSecretKey = ledger.DustSecretKey.fromSeed(getDustSeed(seed));
  const unshieldedKeystore = createKeystore(getUnshieldedSeed(seed), fixture.getNetworkId());

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
    restoreDustWallet(`${directoryPath}/dust-${filename}`, { ...walletConfig, ...dustWalletConfig }, readIfExists),
  ]);

  if (!restoredShielded || !restoredUnshielded || !restoredDust) {
    logger.info('Building wallet facade from scratch');
    return initWalletWithSeed(seed, fixture);
  } else {
    const restoredWallet = new WalletFacade(restoredShielded, restoredUnshielded, restoredDust);
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
  const unshieldedKeystore = createKeystore(getUnshieldedSeed(seed), fixture.getNetworkId());

  const shieldedWallet = ShieldedWallet(walletConfig).startWithShieldedSeed(getShieldedSeed(seed));
  const dustWallet = DustWallet({ ...walletConfig, ...fixture.getDustWalletConfig() }).startWithSeed(
    getDustSeed(seed),
    ledger.LedgerParameters.initialParameters().dust,
  );
  const unshieldedWallet = UnshieldedWallet({
    ...walletConfig,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));

  const facade: WalletFacade = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
  await facade.start(shieldedSecretKeys, dustSecretKey);
  return { wallet: facade, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

export const waitForSyncUnshielded = (wallet: UnshieldedWallet) =>
  rx.firstValueFrom(
    wallet.state.pipe(
      rx.throttleTime(5_000),
      rx.tap((state) => {
        const applyGap = state.state.progress.highestTransactionId - state.state.progress.appliedId;
        // const txs = state.transactionHistory.length;
        logger.info(`Wallet behind by ${applyGap} indices`);
      }),
      rx.filter((state) => state.state.progress.isStrictlyComplete()),
    ),
  );

export const waitForSyncShielded = (wallet: ShieldedWallet) =>
  rx.firstValueFrom(
    wallet.state.pipe(
      rx.throttleTime(5_000),
      rx.tap((state) => {
        const applyGap = state.state?.progress.highestRelevantIndex - state.state?.progress.appliedIndex;
        const sourceGap = state.state?.progress.highestIndex - state.state?.progress.highestRelevantIndex;
        // const txs = state.transactionHistory.length;
        logger.info(
          `Wallet behind by ${applyGap} indices, source behind by ${sourceGap}, synced = ${state.state?.progress.isStrictlyComplete()}`,
        );
      }),
      rx.filter(
        (state) =>
          state.state?.progress !== undefined &&
          state.state?.progress.highestRelevantIndex - state.state?.progress.appliedIndex === 0n &&
          state.state?.progress.highestIndex - state.state?.progress.highestRelevantIndex <= 50n &&
          state.state?.progress.isStrictlyComplete() === true,
      ),
    ),
  );

export const waitForSyncFacade = async (facade: WalletFacade) =>
  await rx.firstValueFrom(
    facade.state().pipe(
      rx.throttleTime(5_000),
      rx.tap((state) => {
        const applyGap = state.unshielded.progress.highestTransactionId - state.unshielded.progress.appliedId;
        logger.info(`Wallet facade behind by ${applyGap}`);
      }),
      rx.filter((state) => state.isSynced === true),
    ),
  );

export const waitForFacadePending = (wallet: WalletFacade) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.tap((state) => {
        const shieldedPending = state.shielded.pendingCoins.length;
        logger.info(`Shielded wallet pending coins: ${shieldedPending}, waiting for pending coins...`);
        const unshieldedPending = state.shielded.pendingCoins.length;
        logger.info(`Unshielded wallet pending coins: ${unshieldedPending}, waiting for pending coins...`);
      }),
      rx.filter(
        (state) =>
          // Let's allow progress only if pendingCoins are present
          state.shielded.pendingCoins.length > 0 || state.unshielded.pendingCoins.length > 0,
      ),
    ),
  );

export const waitForFacadePendingClear = (wallet: WalletFacade) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.tap((state) => {
        const shieldedPending = state.shielded.pendingCoins.length;
        logger.info(`Shielded wallet pending coins: ${shieldedPending}, waiting for pending coins to clear...`);
        const unshieldedPending = state.unshielded.pendingCoins.length;
        logger.info(`Unshielded wallet pending coins: ${unshieldedPending}, waiting for pending coins to clear...`);
        const dustPending = state.dust.pendingCoins.length;
        logger.info(`Dust wallet pending coins: ${dustPending}, waiting for pending coins to clear...`);
      }),
      rx.debounceTime(10_000),
      rx.filter(
        (state) =>
          // Allow progress only if there are no pending coins
          state.shielded.pendingCoins.length == 0 &&
          state.unshielded.pendingCoins.length == 0 &&
          state.dust.pendingCoins.length == 0,
      ),
    ),
  );

export const waitForFinalizedShieldedBalance = (wallet: ShieldedWallet) =>
  rx.firstValueFrom(
    wallet.state.pipe(
      rx.tap((state) => {
        const pending = state.pendingCoins.length;
        logger.info(`Wallet pending coins: ${pending}, waiting for pending coins cleared...`);
      }),
      rx.filter((state) => {
        // Let's allow progress only if pendingCoins are cleared
        const pending = state.pendingCoins.length;
        return pending === 0;
      }),
    ),
  );

export const waitForUnshieldedCoinUpdate = (wallet: WalletFacade, initialNumAvailableCoins: number) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.tap((state) => {
        const currentNumAvailableCoins = state.unshielded.availableCoins.length;
        logger.info(
          `Unshielded available coins: ${currentNumAvailableCoins}, waiting for more than ${initialNumAvailableCoins}...`,
        );
      }),
      rx.debounceTime(10_000),
      rx.filter((s) => s.isSynced),
      rx.filter((s) => s.unshielded.availableCoins.length > initialNumAvailableCoins),
    ),
  );

export const waitForStateAfterDustRegistration = (wallet: WalletFacade, finalizedTx: ledger.FinalizedTransaction) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.mergeMap(async (state) => {
        const txInHistory = await state.unshielded.transactionHistory.get(finalizedTx.transactionHash());

        return {
          state,
          txFound: txInHistory !== undefined,
        };
      }),
      rx.filter(({ state, txFound }) => txFound && state.isSynced && state.dust.availableCoins.length > 0),
      rx.map(({ state }) => state),
    ),
  );

export const waitForRegisteredTokens = (wallet: WalletFacade) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.tap((s) => {
        const registeredTokens = s.unshielded.availableCoins.filter(
          (coin) => coin.meta.registeredForDustGeneration === true,
        );
        logger.info(`registered tokens: ${registeredTokens.length}`);
      }),
      rx.filter(
        (s) => s.unshielded.availableCoins.filter((coin) => coin.meta.registeredForDustGeneration === true).length > 0,
      ),
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
  hdWallet.clear();
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
  hdWallet.clear();

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
  hdWallet.clear();

  return derivationResult.key;
};

export const sleep = (secs: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, secs * 1000));
};

export const tNightAmount = (amount: bigint): bigint => amount * 10n ** 6n;

export const isArrayUnique = (arr: any[]) => Array.isArray(arr) && new Set(arr).size === arr.length; // eslint-disable-line @typescript-eslint/no-explicit-any

export type MidnightNetwork = 'undeployed' | 'qanet' | 'devnet' | 'testnet' | 'preview' | 'preprod';
