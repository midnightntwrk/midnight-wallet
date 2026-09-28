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
import { type LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';

export class OtherWalletError extends Data.TaggedError('Wallet.Other')<{
  message: string;
  cause?: unknown;
}> {}

export class SyncWalletError extends Data.TaggedError('Wallet.Sync')<{
  message: string;
  cause?: unknown;
}> {}

export class TransactingError extends Data.TaggedError('Wallet.Transacting')<{
  message: string;
  cause?: unknown;
}> {}

export class InsufficientFundsError extends Data.TaggedError('Wallet.InsufficientFunds')<{
  message: string;
  tokenType: string;
}> {}

export class TransactionHistoryError extends Data.TaggedError('Wallet.TransactionHistory')<{
  message: string;
  cause?: unknown;
}> {}

/**
 * A finalized history entry that records no block, met where a block is needed.
 *
 * @remarks
 *   Only an entry restored from a history written before the lifecycle field existed looks like this: it is known to have
 *   been finalized, but the block it landed in was never recorded, and none is invented. It is its own error rather
 *   than a message on {@link TransactionHistoryError} so that a caller which can fetch the block by hash matches on the
 *   tag.
 * @example
 *   ```ts
 *   if (error._tag === 'Wallet.BlocklessFinalizedEntry') fetchBlockFor(error.hash);
 *   ```;
 */
export class BlocklessFinalizedEntryError extends Data.TaggedError('Wallet.BlocklessFinalizedEntry')<{
  readonly message: string;
  /** The transaction whose history entry records no block. */
  readonly hash: string;
}> {}

/**
 * A batch of dust ledger events was not in ascending id order: an event arrived at or below the one before it, or at or
 * below the applied cursor.
 *
 * @remarks
 *   Order is all the wallet can check: dust events share one id sequence with zswap and contract events in the indexer,
 *   so gaps in the stream are normal and a skipped event is only ever caught by the ledger's own insertion check. The
 *   whole batch is refused, nothing is applied and the cursor stays, so the running variant retries from the same
 *   place.
 * @example
 *   ```ts
 *   if (error._tag === 'Wallet.OutOfOrderSyncUpdate') console.warn(`expected above ${error.expected}, got ${error.received}`);
 *   ```
 */
export class OutOfOrderSyncUpdateError extends Data.TaggedError('Wallet.OutOfOrderSyncUpdate')<{
  readonly message: string;
  /** The id the delivered event had to exceed: its predecessor in the batch, or the applied cursor. */
  readonly expected: bigint;
  /** The event id the source delivered instead. */
  readonly received: bigint;
}> {}

export type WalletError =
  | OtherWalletError
  | SyncWalletError
  | TransactingError
  | InsufficientFundsError
  | TransactionHistoryError
  | OutOfOrderSyncUpdateError
  | LedgerOps.LedgerError;
