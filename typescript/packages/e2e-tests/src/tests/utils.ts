import { filter, firstValueFrom, tap, throttleTime } from 'rxjs';
import { WalletState, type Wallet } from '@midnight-ntwrk/wallet-api';
import { TransactionHistoryEntry } from '@midnight-ntwrk/wallet-api';
import { logger } from './logger';

export const waitForSync = (wallet: Wallet) =>
  firstValueFrom(
    wallet.state().pipe(
      throttleTime(10_000),
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

export type MidnightDeployment = 'ariadne-qa' | 'halo2-qa' | 'hardfork-qa' | 'devnet' | 'testnet' | 'local';
