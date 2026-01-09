// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { Data } from 'effect';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { LedgerOps } from '@midnight-ntwrk/wallet-sdk-utilities';

export const WalletError = {
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
  | ProvingError
  | OtherWalletError
  | InsufficientFundsError
  | SubmissionError
  | AddressError
  | SyncWalletError
  | InvalidCoinHashesError
  | TransactingError
  | LedgerOps.LedgerError;

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
  tokenType: ledger.RawTokenType;
  amount: bigint;
}> {}

export class AddressError extends Data.TaggedError('Wallet.Address')<{
  message: string;
  originalAddress: string;
  cause?: unknown;
}> {}

export class InvalidCoinHashesError extends Data.TaggedError('Wallet.InvalidCoinHashes')<{
  message: string;
  missingNonces: Set<ledger.Nonce>;
}> {}

export class TransactingError extends Data.TaggedError('Wallet.Transacting')<{
  message: string;
  cause?: unknown;
}> {}
