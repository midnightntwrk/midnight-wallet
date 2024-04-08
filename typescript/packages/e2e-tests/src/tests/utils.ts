import { filter, firstValueFrom, tap, throttleTime } from 'rxjs';
import { WalletState, type Wallet } from '@midnight-ntwrk/wallet-api';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import pinoPretty from 'pino-pretty';
import pino from 'pino';
import { createWriteStream } from 'node:fs';

export const createLogger = async (logPath: string): Promise<pino.Logger> => {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const pretty: pinoPretty.PrettyStream = pinoPretty({
    colorize: true,
    sync: true,
  });
  const level = 'info' as const;
  return pino(
    {
      level,
      depthLimit: 20,
    },
    pino.multistream([
      { stream: pretty, level: 'info' },
      { stream: createWriteStream(logPath), level },
    ]),
  );
};

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
const logger = await createLogger(path.resolve(currentDir, '..', 'logs', 'utils', `${new Date().toISOString()}.log`));

export const waitForSync = (wallet: Wallet) =>
  firstValueFrom(
    wallet.state().pipe(
      throttleTime(10_000),
      tap((state) => {
        const scanned = state.syncProgress?.synced ?? 0n;
        const total = state.syncProgress?.total.toString() ?? 'unknown number';
        logger.info(`Wallet scanned ${scanned} indices out of ${total}`);
      }),
      filter((state) => {
        // Let's allow progress only if wallet is synced fully
        const synced = state.syncProgress?.synced ?? 0n;
        const total = state.syncProgress?.total ?? 50n;
        return state.syncProgress !== null && total === synced;
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
  while (!foundTxId) {
    logger.info('Waiting for a txId...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const state = await waitForSync(wallet);
    foundTxId = state.transactionHistory.flatMap((tx) => tx.identifiers).some((id) => id === txId);
    if (foundTxId) logger.info(`TxId ${txId} found`);
  }
};

export const walletStateTrimmed = (state: WalletState) => {
  const { transactionHistory, coins, availableCoins, ...rest } = state;
  return rest;
};

export type MidnightNetwork = 'undeployed' | 'devnet';

export type MidnightDeployment = 'ariadne-temp' | 'ariadne-qa' | 'devnet' | 'qanet' | 'local';
