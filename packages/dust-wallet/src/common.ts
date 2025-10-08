import { Either } from 'effect';
import { WalletError } from '@midnight-ntwrk/wallet-sdk-shielded/v1';

export const ledgerTry = <A>(fn: () => A): Either.Either<A, WalletError.LedgerError> => {
  return Either.try({
    try: fn,
    catch: (error) => {
      const message = error instanceof Error ? error.message : `${error?.toString()}`;
      return new WalletError.LedgerError({ error: `Error from ledger: ${message}` });
    },
  });
};

export const generateHex = (len: number): string =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  [...Array(len)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

export const randomNonce = (): string => generateHex(64);

export const dateToSeconds = (date: Date): bigint => {
  return BigInt(Math.floor(date.getTime() / 1000));
};

export const secondsToDate = (seconds: bigint): Date => {
  return new Date(Number(seconds) * 1000);
};
