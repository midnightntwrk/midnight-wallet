import { Data } from 'effect';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { LedgerOps } from '@midnight-ntwrk/wallet-sdk-utilities';

export const WalletError = {
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
};
export type WalletError =
  | OtherWalletError
  | InsufficientFundsError
  | AddressError
  | SyncWalletError
  | TransactingError
  | LedgerOps.LedgerError
  | SignError;

export class OtherWalletError extends Data.TaggedError('Wallet.Other')<{
  message: string;
  cause?: unknown;
}> {}

export class SyncWalletError extends Data.TaggedError('Wallet.Sync')<{
  message: string;
  cause?: unknown;
}> {}

export class InsufficientFundsError extends Data.TaggedError('Wallet.InsufficientFunds')<{
  message: string;
  tokenType: ledger.RawTokenType;
  amount: bigint;
}> {}

export class AddressError extends Data.TaggedError('Wallet.Address')<{
  message: string;
  originalAddress: string;
  cause?: unknown;
}> {}

export class TransactingError extends Data.TaggedError('Wallet.Transacting')<{
  message: string;
  cause?: unknown;
}> {}

export class SignError extends Data.TaggedError('Wallet.Sign')<{
  message: string;
  cause?: unknown;
}> {}
