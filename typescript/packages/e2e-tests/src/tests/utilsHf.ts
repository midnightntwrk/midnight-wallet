/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import * as OriginalFunctions from './utils';
import { Resource } from '@midnight-ntwrk/wallet_pre_hf';
import { TransactionHistoryEntry, WalletState, type Wallet } from '@midnight-ntwrk/wallet-api_hf';
import { Readable } from 'node:stream';
import { logger } from './logger';
import { filter, firstValueFrom, tap, throttleTime } from 'rxjs';
import { nativeToken } from '@midnight-ntwrk/zswap_v2';

export function verifyThatLogIsPresent(
  stream: Readable,
  regexToWaitFor: RegExp,
  timeoutMs: number,
  times: number = 1,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let textAppeared = false;
    let timesAppeared = 0;
    const timeoutId = setTimeout(() => {
      stream.destroy();
      if (!textAppeared) {
        reject(new Error(`Timeout: Log entry not found: ${regexToWaitFor}`));
      }
    }, timeoutMs);
    stream
      .on('data', (line) => {
        if (regexToWaitFor.test(line as string)) {
          textAppeared = true;
          timesAppeared++;
          logger.info(`${regexToWaitFor} found`);
          if (timesAppeared === times) {
            clearTimeout(timeoutId);
            resolve();
          }
        }
      })
      .on('error', (error) => {
        clearTimeout(timeoutId);
        logger.error(error);
      })
      .on('end', () => {
        if (!textAppeared) {
          clearTimeout(timeoutId);
          reject(new Error(`Stream ended: Log entry not found: ${regexToWaitFor}`));
        }
      });
  });
}

// Define an interface for the normalized state
interface NormalizedWalletState {
  normalized: Array<Omit<TransactionHistoryEntry, 'transaction'>>;
  [key: string]: any; // for other properties from state
}

export const closeWallet = OriginalFunctions.closeWallet as (wallet: Wallet & Resource) => Promise<void>;

export const compareStates = (a: WalletState, b: WalletState) => OriginalFunctions.compareStates(a as any, b as any);

export function normalizeWalletState(state: WalletState): NormalizedWalletState {
  const normalized = state.transactionHistory.map((txHistoryEntry: TransactionHistoryEntry) => {
    const { transaction, ...otherProps } = txHistoryEntry;
    return otherProps;
  });
  const { transactionHistory, syncProgress, ...otherProps } = state;
  return { ...otherProps, normalized };
}

export const waitForIndex = (wallet: Wallet, index: number) =>
  firstValueFrom(
    wallet.state().pipe(
      // throttleTime(50),
      tap((state) => {
        const scanned = state.syncProgress?.synced ?? 0n;
        const total = state.syncProgress?.total.toString() ?? 'unknown number';
        const txs = state.transactionHistory.length;
        logger.info(
          `Wallet scanned ${scanned} indices out of ${total}, transactions=${txs}, balance=${
            state.balances[nativeToken()]
          }`,
        );
      }),
      filter((state) => {
        // Let's allow progress only if wallet is synced fully
        const synced = state.syncProgress?.synced ?? 0n;
        return state.syncProgress !== undefined && synced === BigInt(index);
      }),
    ),
  );

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

export const waitForTxInHistory = async (txId: string, wallet: Wallet) =>
  firstValueFrom(
    wallet.state().pipe(
      tap({
        next: (state) => {
          const tx = state.transactionHistory.some((tx) => tx.identifiers.includes(txId));
          if (tx) {
            logger.info(`Transaction ${txId} found in history.`);
          } else {
            logger.info(`Transaction ${txId} not found yet.`);
          }
        },
      }),
      filter((state) => state.transactionHistory.some((tx) => tx.identifiers.includes(txId))),
    ),
  );

export const walletStateTrimmed = (state: WalletState) => OriginalFunctions.walletStateTrimmed(state as any) as any;
