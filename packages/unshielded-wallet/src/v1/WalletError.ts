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
import type * as ledger from '@midnight-ntwrk/ledger-v7';

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
  | SignError
  | ApplyTransactionError
  | RollbackUtxoError
  | SpendUtxoError;

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

export class ApplyTransactionError extends Data.TaggedError('Wallet.ApplyTransaction')<{
  message: string;
  cause?: unknown;
}> {}

export class RollbackUtxoError extends Data.TaggedError('Wallet.RollbackUtxo')<{
  message: string;
  utxo: ledger.Utxo;
  cause?: unknown;
}> {}

export class SpendUtxoError extends Data.TaggedError('Wallet.SpendUtxo')<{
  message: string;
  utxo: ledger.Utxo;
  cause?: unknown;
}> {}

export class UtxoNotFoundError extends Data.TaggedError('UtxoNotFoundError')<{
  readonly utxo: ledger.Utxo;
}> {}
