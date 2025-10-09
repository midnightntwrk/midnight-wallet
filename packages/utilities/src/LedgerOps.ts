import { Either, Data } from 'effect';

export class LedgerError extends Data.TaggedError('LedgerError')<{
  readonly error: string;
  readonly cause?: unknown;
}> {}

export const ledgerTry = <A>(fn: () => A): Either.Either<A, LedgerError> => {
  return Either.try({
    try: fn,
    catch: (error) => {
      const message = error instanceof Error ? error.message : `${error?.toString()}`;
      return new LedgerError({ error: `Error from ledger: ${message}`, cause: error });
    },
  });
};

export const generateHex = (len: number): string => {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(len / 2))).toString('hex');
};

export const randomNonce = (): string => generateHex(64);
