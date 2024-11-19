/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { filter, firstValueFrom, tap, throttleTime } from 'rxjs';
import { WalletState, type Wallet } from '@midnight-ntwrk/wallet-api';
import { TransactionHistoryEntry } from '@midnight-ntwrk/wallet-api';
import { logger } from './logger';
import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { TestContainersFixture } from './test-fixture';
import { NetworkId } from '@midnight-ntwrk/zswap';
import { existsSync } from 'node:fs';
import { exit } from 'node:process';
import * as fsAsync from 'node:fs/promises';
import * as fs from 'node:fs';

export const waitForSyncProgress = async (wallet: Wallet) =>
  await firstValueFrom(
    wallet.state().pipe(
      throttleTime(5_000),
      tap((state) => {
        const scanned = state.syncProgress?.synced ?? 0n;
        const total = state.syncProgress?.total.toString() ?? 'unknown number';
        logger.info(`Wallet scanned ${scanned} indices out of ${total}`);
      }),
      filter((state) => {
        // Let's allow progress only if syncProgress is defined
        return state.syncProgress !== undefined;
      }),
    ),
  );

export const isAnotherChain = async (wallet: Wallet, offset: number) => {
  const state = await waitForSyncProgress(wallet);
  return state.syncProgress!.total < offset;
};

export const streamToString = async (stream: fs.ReadStream): Promise<string> => {
  const chunks: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
};

export const provideWallet = async (
  filename: string,
  seed: string,
  networkId: NetworkId,
  fixture: TestContainersFixture,
): Promise<Wallet & Resource> => {
  let wallet: Wallet & Resource;
  const directoryPath = process.env.SYNC_CACHE;
  if (!directoryPath) {
    logger.warn('SYNC_CACHE env var not set');
    exit(1);
  }
  if (existsSync(`${directoryPath}/${filename}`)) {
    logger.info(`Attempting to restore state from ${directoryPath}/${filename}`);
    try {
      const serializedStream = fs.createReadStream(`${directoryPath}/${filename}`, 'utf-8');
      const serialized = await streamToString(serializedStream);
      serializedStream.on('finish', () => serializedStream.close());
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
      if (await isAnotherChain(wallet, stateObject.offset)) {
        logger.warn('The chain was reset, building wallet from scratch');
        wallet = await WalletBuilder.buildFromSeed(
          fixture.getIndexerUri(),
          fixture.getIndexerWsUri(),
          fixture.getProverUri(),
          fixture.getNodeUri(),
          seed,
          networkId,
          'info',
        );
      } else {
        const newState = await waitForSync(wallet);
        if ((newState.syncProgress?.total ?? 0n) >= stateObject.offset) {
          logger.info('Wallet was able to sync from restored state');
        } else {
          logger.info(stateObject.offset);
          logger.info(newState.syncProgress?.total);
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
    logger.info(`${directoryPath}/${filename} not present, building a wallet from scratch`);
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
  const directoryPath = process.env.SYNC_CACHE;
  if (!directoryPath) {
    logger.warn('SYNC_CACHE env var not set');
    exit(1);
  }
  logger.info(`Saving state in ${directoryPath}/${filename}`);
  try {
    await fsAsync.mkdir(directoryPath, { recursive: true });
    const serializedState = await wallet.serializeState();
    const writer = fs.createWriteStream(`${directoryPath}/${filename}`);
    writer.write(serializedState);

    writer.on('finish', function () {
      logger.info(`File '${directoryPath}/${filename}' written successfully.`);
    });

    writer.on('error', function (err) {
      logger.error(err);
    });
    writer.end();
  } catch (e) {
    if (typeof e === 'string') {
      logger.warn(e);
    } else if (e instanceof Error) {
      logger.warn(e.message);
    }
  }
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

export type MidnightDeployment = 'qanet' | 'testnet' | 'local';
