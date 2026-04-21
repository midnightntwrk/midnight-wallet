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
import { logger } from './logger.js';
import { TestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import {
  type NetworkId,
  InMemoryTransactionHistoryStorage,
  TransactionHistoryStorage,
} from '@midnight-ntwrk/wallet-sdk-abstractions';
import { WalletEntrySchema, mergeWalletEntries } from '@midnight-ntwrk/wallet-sdk-facade';
import { existsSync } from 'node:fs';
import { exit } from 'node:process';
import * as fsAsync from 'node:fs/promises';
import type * as fs from 'node:fs';
import { ShieldedWallet, type ShieldedWalletAPI, type ShieldedWalletClass } from '@midnight-ntwrk/wallet-sdk-shielded';
import { ShieldedAddress, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { WalletFacade, type WalletEntry } from '@midnight-ntwrk/wallet-sdk-facade';
import {
  createKeystore,
  PublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { type DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-dust-wallet/v1';
import { BlockHash } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import { QueryRunner } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';

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
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<TransactionHistoryStorage.TransactionHistoryEntryWithHash>,
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
    restoreUnshieldedWallet(
      `${directoryPath}/unshielded-${filename}`,
      seed,
      fixture,
      readIfExists,
      walletConfig.txHistoryStorage,
    ),
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
  const unshieldedKeystore = createKeystore(getUnshieldedSeed(seed), fixture.getNetworkId());

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

export const waitForDustBalance = (wallet: WalletFacade) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.tap((state) => {
        const dustBalance = state.dust.balance(new Date());
        logger.info(`Dust balance: ${dustBalance}, waiting for dust balance > 7 * 10^14...`);
      }),
      rx.filter((state) => state.dust.balance(new Date()) > 7n * 10n ** 14n),
    ),
  );

export const waitForFinalizedShieldedBalance = (wallet: ShieldedWalletAPI) =>
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
        const txInHistory = await wallet.queryTxHistoryByHash(finalizedTx.transactionHash());

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

export const waitForTxInHistory = async (
  txHash: string,
  wallet: WalletFacade,
  ready?: (entry: WalletEntry) => boolean,
) => {
  const isReady = ready ?? (() => true);
  const txEntry = await rx.firstValueFrom(
    wallet.state().pipe(
      rx.filter((state) => state.isSynced),
      rx.mergeMap(async () => wallet.queryTxHistoryByHash(txHash)),
      rx.tap((txEntry) => {
        logger.info(
          `Waiting for tx ${txHash} in history, found: ${txEntry !== undefined}, ready: ${txEntry !== undefined && isReady(txEntry)}`,
        );
      }),
      rx.filter((txEntry): txEntry is WalletEntry => txEntry !== undefined && isReady(txEntry)),
    ),
  );
  expect(txEntry).toBeDefined();
  expect(txEntry.hash).toBe(txHash);
  expect(txEntry.status).toBe('SUCCESS');
  return txEntry;
};

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

const fetchBlockHeight = async (indexerHttpUrl: string): Promise<number> => {
  const result = await QueryRunner.runPromise(BlockHash, { offset: null }, { url: indexerHttpUrl });
  if (!result.block) throw new Error('No block returned from indexer');
  return result.block.height;
};

/**
 * Waits for the blockchain to produce at least one new block by polling the
 * indexer for the current block height. Resolves as soon as the height
 * increases from its initial value.
 */
export const waitForBlockAdvancement = async (indexerHttpUrl: string, timeoutMs = 60_000): Promise<void> => {
  const initialHeight = await fetchBlockHeight(indexerHttpUrl);
  logger.info(`Waiting for block advancement beyond height ${initialHeight}...`);

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(2);
    const currentHeight = await fetchBlockHeight(indexerHttpUrl);
    logger.info(`Current block height: ${currentHeight} (waiting for > ${initialHeight})`);
    if (currentHeight > initialHeight) {
      logger.info('Block advancement detected');
      return;
    }
  }
  throw new Error(`Timed out waiting for block advancement beyond height ${initialHeight} after ${timeoutMs}ms`);
};

export const tNightAmount = (amount: bigint): bigint => amount * 10n ** 6n;

export const isArrayUnique = (arr: any[]) => Array.isArray(arr) && new Set(arr).size === arr.length; // eslint-disable-line @typescript-eslint/no-explicit-any

export function expectValidUnshieldedUtxoFields(utxo: NonNullable<WalletEntry['unshielded']>['createdUtxos'][number]) {
  expect(typeof utxo.value).toBe('bigint');
  expect(typeof utxo.owner).toBe('string');
  expect(typeof utxo.tokenType).toBe('string');
  expect(typeof utxo.intentHash).toBe('string');
  expect(typeof utxo.outputIndex).toBe('number');
}

export function expectValidShieldedCoinFields(coin: NonNullable<WalletEntry['shielded']>['receivedCoins'][number]) {
  expect(typeof coin.type).toBe('string');
  expect(coin.type.length).toBeGreaterThan(0);
  expect(typeof coin.nonce).toBe('string');
  expect(coin.nonce.length).toBeGreaterThan(0);
  expect(typeof coin.value).toBe('bigint');
  expect(typeof coin.mtIndex).toBe('bigint');
}

export function expectValidShieldedTxHistoryEntry(entry: WalletEntry) {
  expect(entry.shielded).toBeDefined();
  expect(Array.isArray(entry.shielded!.receivedCoins)).toBe(true);
  expect(Array.isArray(entry.shielded!.spentCoins)).toBe(true);
  for (const coin of [...entry.shielded!.receivedCoins, ...entry.shielded!.spentCoins]) {
    expectValidShieldedCoinFields(coin);
  }
}

export function expectValidUnshieldedTxHistoryEntry(entry: WalletEntry) {
  expect(entry.unshielded).toBeDefined();
  expect(Array.isArray(entry.unshielded!.createdUtxos)).toBe(true);
  expect(Array.isArray(entry.unshielded!.spentUtxos)).toBe(true);
  for (const utxo of [...entry.unshielded!.createdUtxos, ...entry.unshielded!.spentUtxos]) {
    expectValidUnshieldedUtxoFields(utxo);
  }
}

export function expectValidUnshieldedTxHistoryEntries(entries: readonly WalletEntry[]) {
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    expectValidUnshieldedTxHistoryEntry(entry);
  }
}

/**
 * Asserts a sender's shielded tx history entry has valid spentCoins.
 */
export function expectSenderShieldedTxHistory(entry: WalletEntry) {
  expect(entry.shielded).toBeDefined();
  expect(entry.shielded!.spentCoins.length).toBeGreaterThan(0);
  expectValidShieldedTxHistoryEntry(entry);
}

/**
 * Asserts a receiver's shielded tx history entry has valid receivedCoins,
 * and that a coin matching the expected value exists with valid fields.
 */
export function expectReceiverShieldedTxHistory(entry: WalletEntry, expectedValue: bigint) {
  expect(entry.shielded).toBeDefined();
  expect(entry.shielded!.receivedCoins.length).toBeGreaterThan(0);
  const receivedCoin = entry.shielded!.receivedCoins.find((c) => c.value === expectedValue);
  expect(receivedCoin).toBeDefined();
  expectValidShieldedCoinFields(receivedCoin!);
  expectValidShieldedTxHistoryEntry(entry);
}

/**
 * Asserts a sender's unshielded tx history entry has valid spentUtxos.
 */
export function expectSenderUnshieldedTxHistory(entry: WalletEntry) {
  expect(entry.unshielded).toBeDefined();
  expect(entry.unshielded!.spentUtxos.length).toBeGreaterThan(0);
  expectValidUnshieldedTxHistoryEntry(entry);
}

/**
 * Asserts a receiver's unshielded tx history entry has valid createdUtxos,
 * and that a UTXO matching the expected value exists with valid fields.
 */
export function expectReceiverUnshieldedTxHistory(entry: WalletEntry, expectedValue: bigint) {
  expect(entry.unshielded).toBeDefined();
  expect(entry.unshielded!.createdUtxos.length).toBeGreaterThan(0);
  const receivedUtxo = entry.unshielded!.createdUtxos.find((u) => u.value === expectedValue);
  expect(receivedUtxo).toBeDefined();
  expectValidUnshieldedUtxoFields(receivedUtxo!);
  expectValidUnshieldedTxHistoryEntry(entry);
}

/**
 * Asserts that tx history entries from a storage contain at least one entry
 * with the specified section ('shielded' or 'unshielded').
 */
export async function expectTxHistoryHasSection(
  storage: { getAll(): Promise<readonly Record<string, unknown>[]> },
  section: 'shielded' | 'unshielded',
) {
  const entries = await storage.getAll();
  expect(entries.length).toBeGreaterThan(0);
  const matching = entries.filter((e) => e[section] !== undefined);
  expect(matching.length).toBeGreaterThan(0);
  return entries;
}

export type MidnightNetwork = 'undeployed' | 'qanet' | 'devnet' | 'testnet' | 'preview' | 'preprod';
