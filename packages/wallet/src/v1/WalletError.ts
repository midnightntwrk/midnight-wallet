import { WalletError as TheScalaWalletError } from '@midnight-ntwrk/wallet';
import { Data } from 'effect';
import * as zswap from '@midnight-ntwrk/zswap';

export const WalletError = {
  fromScala(scalaWalletError: TheScalaWalletError): WalletError {
    return new ScalaWalletError({
      message: `Wallet error: ${scalaWalletError.message}`,
      cause: scalaWalletError,
    });
  },

  proving(err: Error): WalletError {
    return new ProvingError({
      message: `Wallet proving error: ${err.message}`,
      cause: err,
    });
  },

  other(err: unknown): WalletError {
    let message: string;
    if (err) {
      if (typeof err == 'object' && 'message' in err) {
        message = String(err.message);
      } else if (typeof err == 'string') {
        message = err;
      } else {
        message = '';
      }
    } else {
      message = '';
    }
    return new OtherWalletError({ message: `Other wallet error: ${message}`, cause: err });
  },

  submission(err: unknown): WalletError {
    const message: string = err && typeof err == 'object' && 'message' in err ? String(err.message) : '';
    return new SubmissionError({ message: `Transaction submission error: ${message}`, cause: err });
  },
};
export type WalletError =
  | ScalaWalletError
  | ProvingError
  | OtherWalletError
  | InsufficientFundsError
  | SubmissionError
  | AddressError
  | SyncWalletError;

export class ScalaWalletError extends Data.TaggedError('Wallet.Scala')<{
  message: string;
  cause: TheScalaWalletError;
}> {}

export class ProvingError extends Data.TaggedError('Wallet.Proving')<{
  message: string;
  cause: Error;
}> {}

export class OtherWalletError extends Data.TaggedError('Wallet.Other')<{
  message: string;
  cause?: unknown;
}> {}

export class SyncWalletError extends Data.TaggedError('Wallet.Sync')<{
  message: string;
  cause?: unknown;
}> {}

export class SubmissionError extends Data.TaggedError('Wallet.SubmissionWalletError')<{
  message: string;
  cause?: unknown;
}> {}

export class InsufficientFundsError extends Data.TaggedError('Wallet.InsufficientFunds')<{
  message: string;
  tokenType: zswap.TokenType;
  amount: bigint;
}> {}

export class AddressError extends Data.TaggedError('Wallet.Address')<{
  message: string;
  originalAddress: string;
  cause?: unknown;
}> {}
