/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { filter, firstValueFrom, tap, throttleTime } from 'rxjs';
import { WalletState, type Wallet } from '@midnight-ntwrk/wallet-api';
import { TransactionHistoryEntry } from '@midnight-ntwrk/wallet-api';
import { logger } from './logger';
import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { TestContainersFixture } from './test-fixture';
import { NetworkId } from '@midnight-ntwrk/zswap';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const provideWallet = async (
  filename: string,
  seed: string,
  networkId: NetworkId,
  fixture: TestContainersFixture,
): Promise<Wallet & Resource> => {
  let wallet: Wallet & Resource;
  if (existsSync(filename)) {
    logger.info(`Attempting to restore state from ${filename}`);
    try {
      const serialized = readFileSync(filename, 'utf-8');
      wallet = await WalletBuilder.restore(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        serialized,
        'info',
      );
      wallet.start();
      const stateObject = JSON.parse(serialized);
      const newState = await waitForSync(wallet);
      if ((newState.syncProgress?.total ?? 0n) >= stateObject.offset) {
        logger.info('Wallet was able to sync from restored state');
      } else {
        logger.info(stateObject.newState.syncProgress?.total);
        logger.info(stateObject.offset);
        logger.warn('Wallet was not able to sync from restored state, building wallet from scratch');
        wallet = await WalletBuilder.buildFromSeed(
          fixture.getIndexerUri(),
          fixture.getIndexerWsUri(),
          fixture.getProverUri(),
          fixture.getNodeUri(),
          seed,
          networkId,
          'info',
        );
      }
    } catch (error: unknown) {
      if (typeof error === 'string') {
        logger.error(error);
      } else if (error instanceof Error) {
        logger.error(error.message);
      }
      logger.warn('Wallet was not able to restore using the stored state, building wallet from scratch');
      wallet = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seed,
        networkId,
        'info',
      );
    }
  } else {
    logger.info(`${filename} not present, building a wallet from scratch`);
    wallet = await WalletBuilder.buildFromSeed(
      fixture.getIndexerUri(),
      fixture.getIndexerWsUri(),
      fixture.getProverUri(),
      fixture.getNodeUri(),
      seed,
      networkId,
      'info',
    );
  }
  return wallet;
};

export const saveState = async (wallet: Wallet, filename: string) => {
  logger.info(`Saving state in ${filename}`);
  const serializedState = await wallet.serializeState();
  writeFileSync(filename, serializedState, {
    flag: 'w',
  });
};

export const closeWallet = async (wallet: Wallet & Resource) => {
  try {
    await wallet.close();
  } catch (e: unknown) {
    if (typeof e === 'string') {
      logger.warn(e);
    } else if (e instanceof Error) {
      logger.warn(e.message);
    }
  }
};

export const waitForSync = (wallet: Wallet) =>
  firstValueFrom(
    wallet.state().pipe(
      throttleTime(5_000),
      tap((state) => {
        const scanned = state.syncProgress?.synced ?? 0n;
        const total = state.syncProgress?.total.toString() ?? 'unknown number';
        const txs = state.transactionHistory.length;
        logger.info(`Wallet scanned ${scanned} indices out of ${total}, transactions=${txs}`);
      }),
      filter((state) => {
        // Let's allow progress only if wallet is synced fully
        const synced = state.syncProgress?.synced ?? 0n;
        const total = state.syncProgress?.total ?? 50n;
        return state.syncProgress !== undefined && total === synced;
      }),
    ),
  );

export const waitForPending = (wallet: Wallet) =>
  firstValueFrom(
    wallet.state().pipe(
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

export const waitForFinalizedBalance = (wallet: Wallet) =>
  firstValueFrom(
    wallet.state().pipe(
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

export const waitForTxInHistory = async (txId: string, wallet: Wallet) => {
  let foundTxId = false;
  logger.info('Waiting for a txId...');
  while (!foundTxId) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const state = await waitForSync(wallet);
    foundTxId = state.transactionHistory.flatMap((tx) => tx.identifiers).some((id) => id === txId);
    if (foundTxId) {
      console.timeEnd('txProcessing');
      logger.info(`TxId ${txId} found`);
    }
  }
};

export const walletStateTrimmed = (state: WalletState) => {
  const { transactionHistory, coins, availableCoins, ...rest } = state;
  return rest;
};

export function normalizeWalletState(state: WalletState) {
  const normalized = state.transactionHistory.map((txHistoryEntry: TransactionHistoryEntry) => {
    const { transaction, ...otherProps } = txHistoryEntry;
    return otherProps;
  });
  const { transactionHistory, syncProgress, ...otherProps } = state;
  return { ...otherProps, normalized };
}

export function compareStates(state1: WalletState, state2: WalletState) {
  const normalized1 = normalizeWalletState(state1);
  const normalized2 = normalizeWalletState(state2);
  expect(normalized2).toStrictEqual(normalized1);
}

export const isArrayUnique = (arr: any[]) => Array.isArray(arr) && new Set(arr).size === arr.length;

export type MidnightNetwork = 'undeployed' | 'devnet' | 'testnet';

export type MidnightDeployment = 'halo2-qa' | 'hardfork-qa' | 'testnet' | 'local';
