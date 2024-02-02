import { filter, firstValueFrom, tap, throttleTime } from 'rxjs';
import { type Wallet } from '@midnight-ntwrk/wallet-api';

export const waitForSync = (wallet: Wallet) =>
  firstValueFrom(
    wallet.state().pipe(
      throttleTime(10_000),
      tap((state) => {
        const scanned = state.syncProgress?.synced ?? 0n;
        const total = state.syncProgress?.total.toString() ?? 'unknown number';
        console.log(`Wallet scanned ${scanned} blocks out of ${total}`);
      }),
      filter((state) => {
        // Let's allow progress only if wallet is close enough
        const synced = state.syncProgress?.synced ?? 0n;
        const total = state.syncProgress?.total ?? 1_000n;
        return total - synced < 100n;
      }),
    ),
  );

export const waitForPending = (wallet: Wallet) =>
  firstValueFrom(
    wallet.state().pipe(
      tap((state) => {
        const pending = state.pendingCoins.length;
        console.log(`Wallet pending coins: ${pending}`);
        console.log(`Waiting for pending coins...`);
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
      throttleTime(5_000),
      tap((state) => {
        const pending = state.pendingCoins.length;
        console.log(`Wallet pending coins: ${pending}`);
        console.log(`Waiting for pending coins cleared...`);
      }),
      filter((state) => {
        // Let's allow progress only if pendingCoins are cleared
        const pending = state.pendingCoins.length;
        return pending === 0;
      }),
    ),
  );

export type MidnightNetwork = 'undeployed' | 'devnet';

export type MidnightDeployment = 'devnet' | 'qanet' | 'local';
