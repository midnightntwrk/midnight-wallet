// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
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
import type * as ledger from '@midnightntwrk/ledger-v9';

export type WalletError =
  | OtherWalletError
  | InsufficientFundsError
  | AddressError
  | SyncWalletError
  | TransactingError
  | SignError
  | SchemeMismatchError
  | ApplyTransactionError
  | OutOfOrderSyncUpdateError
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

/**
 * Raised when a signature scheme (`schnorr` vs `ecdsa`) is mixed across an unshielded key, address, or signature.
 * Mismatches are rejected early — at wallet construction or at signature provision — never silently coerced. The `at`
 * field records where the mismatch was caught.
 */
export class SchemeMismatchError extends Data.TaggedError('Wallet.SchemeMismatch')<{
  message: string;
  expected: ledger.SignatureKind;
  supplied: ledger.SignatureKind;
  at: 'construction' | 'signature-provision';
}> {}

export class ApplyTransactionError extends Data.TaggedError('Wallet.ApplyTransaction')<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Raised when a sync source delivers a transaction the wallet has already folded — an id strictly below its applied
 * cursor — so applying it again would double-count the UTXOs that transaction created or spent.
 *
 * @remarks
 *   The id a wallet is served is the indexer's global transaction id filtered to this address, so what reaches it is a
 *   strictly increasing but sparse subsequence: "is this past my cursor?" is the only ordering question it can answer,
 *   and contiguity is not one of them. An id EQUAL to the cursor is the resume boundary answered inclusively and folds
 *   to a no-op rather than to this error; only a strictly lower one is a replay.
 *
 *   Nothing is written when it is produced. The fold hands this back in place of a new state, so the running variant
 *   never writes its `SubscriptionRef`: the wallet keeps the state and the cursor it had, the sync stream fails, and
 *   the retry reopens the subscription at that same unmoved cursor — which is what gives the source the chance to
 *   deliver the timeline in order.
 * @example
 *   ```ts
 *   import { Either } from 'effect';
 *
 *   const outcome = capability.applyUpdate(wallet, update, activeRange);
 *   if (Either.isLeft(outcome) && outcome.left._tag === 'Wallet.OutOfOrderSyncUpdate') {
 *   console.warn(`replayed ${outcome.left.received}, already at ${outcome.left.expected}`);
 *   }
 *   ```
 */
export class OutOfOrderSyncUpdateError extends Data.TaggedError('Wallet.OutOfOrderSyncUpdate')<{
  readonly message: string;
  /** The cursor the delivered id had to exceed: the highest transaction id already folded into this wallet. */
  readonly expected: bigint;
  /** The transaction id the source delivered. */
  readonly received: bigint;
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

export class TransactionHistoryError extends Data.TaggedError('Wallet.TransactionHistory')<{
  message: string;
  cause?: unknown;
}> {}

export class UtxoNotFoundError extends Data.TaggedError('UtxoNotFoundError')<{
  readonly utxo: ledger.Utxo;
}> {}
