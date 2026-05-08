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
import { Schema } from 'effect';

export const TransactionHashSchema = Schema.String;

export type TransactionHash = Schema.Schema.Type<typeof TransactionHashSchema>;

export const TransactionHistoryStatusSchema = Schema.Literal('SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS');

export type TransactionHistoryStatus = Schema.Schema.Type<typeof TransactionHistoryStatusSchema>;

export const PendingLifecycleSchema = Schema.Struct({
  status: Schema.Literal('pending'),
  submittedAt: Schema.Date,
});

export const FinalizedLifecycleSchema = Schema.Struct({
  status: Schema.Literal('finalized'),
  finalizedAt: Schema.Date,
});

export const RejectedLifecycleSchema = Schema.Struct({
  status: Schema.Literal('rejected'),
  rejectedAt: Schema.Date,
  reason: Schema.optional(Schema.String),
});

export const TransactionLifecycleSchema = Schema.Union(
  PendingLifecycleSchema,
  FinalizedLifecycleSchema,
  RejectedLifecycleSchema,
);

export type TransactionLifecycle = Schema.Schema.Type<typeof TransactionLifecycleSchema>;

export const PendingTransactionHistoryCommonSchema = Schema.Struct({
  hash: TransactionHashSchema,
  identifiers: Schema.Array(Schema.String),
  lifecycle: PendingLifecycleSchema,
});

export type PendingTransactionHistoryCommon = Schema.Schema.Type<typeof PendingTransactionHistoryCommonSchema>;

export const RejectedTransactionHistoryCommonSchema = Schema.Struct({
  hash: TransactionHashSchema,
  identifiers: Schema.Array(Schema.String),
  lifecycle: RejectedLifecycleSchema,
});

export type RejectedTransactionHistoryCommon = Schema.Schema.Type<typeof RejectedTransactionHistoryCommonSchema>;

export const FinalizedTransactionHistoryCommonSchema = Schema.Struct({
  hash: TransactionHashSchema,
  protocolVersion: Schema.Number,
  status: TransactionHistoryStatusSchema,
  identifiers: Schema.optional(Schema.Array(Schema.String)),
  timestamp: Schema.optional(Schema.Date),
  fees: Schema.optional(Schema.NullOr(Schema.BigInt)),
  lifecycle: FinalizedLifecycleSchema,
});

export type FinalizedTransactionHistoryCommon = Schema.Schema.Type<typeof FinalizedTransactionHistoryCommonSchema>;

export const TransactionHistoryCommonSchema = Schema.Union(
  PendingTransactionHistoryCommonSchema,
  FinalizedTransactionHistoryCommonSchema,
  RejectedTransactionHistoryCommonSchema,
);

export type TransactionHistoryCommon = Schema.Schema.Type<typeof TransactionHistoryCommonSchema>;

export type SerializedTransactionHistory = string;

/**
 * An entry with common fields plus any additional properties (wallet sections). Used by wallet packages for
 * projection/filtering when the exact type is not known.
 */
export type TransactionHistoryEntryWithHash = TransactionHistoryCommon & Record<string, unknown>;

/**
 * Input for `gotFinalized` — the finalized entry minus its `lifecycle` field, which the storage attaches itself.
 * Carries `finalizedAt` directly so callers don't construct the lifecycle object.
 */
export type FinalizedEntryInput<T extends FinalizedTransactionHistoryCommon = FinalizedTransactionHistoryCommon> = Omit<
  T,
  'lifecycle'
> & { readonly finalizedAt: Date };

/**
 * View of a transaction the lifecycle methods need to derive a storage key. Kept ledger-agnostic so the abstractions
 * package doesn't pull in a specific ledger version.
 *
 * - `identifiers()` is the stable, always-available list used as the entry's `identifiers` field and as the fallback key.
 * - `transactionHash()` is optional because not every variant of an in-flight tx is hashable (e.g. unproven txs);
 */
export interface TransactionRef {
  identifiers(): readonly string[];
  transactionHash?(): { toString(): string };
}

/**
 * Read-side of a transaction history storage. T appears only in output position, so this interface is **covariant** in
 * T: a `TransactionHistoryReader<Specific>` is assignable to `TransactionHistoryReader<Wider>`.
 */
export interface TransactionHistoryReader<T extends { hash: TransactionHash } = TransactionHistoryCommon> {
  getAll(): Promise<readonly T[]>;
  get(hash: TransactionHash): Promise<T | undefined>;
  serialize(): Promise<SerializedTransactionHistory>;
}

/**
 * Write-side of a transaction history storage. Exposes lifecycle-aware methods only — `gotPending`, `gotFinalized`,
 * `gotRejected`. Underlying primitives (upsert / delete / find-by-identifiers) are implementation details and are not
 * part of the public contract.
 *
 * Each `got*` method represents a transition the facade or sync layer has observed. Implementations are responsible for
 * keeping the storage internally consistent across keys (in particular: clearing a prior `pending` entry keyed by the
 * first identifier when its `finalized` or `rejected` counterpart arrives keyed by the tx hash).
 *
 * T appears only in `gotFinalized`'s input position, so this interface is **contravariant** in T: a
 * `TransactionHistoryWriter<Wider>` is assignable to `TransactionHistoryWriter<Narrower>`.
 */
export interface TransactionHistoryWriter<
  T extends FinalizedTransactionHistoryCommon = FinalizedTransactionHistoryCommon,
> {
  /**
   * Record that a tx has been submitted and is awaiting confirmation. The storage derives the entry key from the tx
   * itself (preferring `transactionHash()` and falling back to the first identifier).
   */
  gotPending(tx: TransactionRef, submittedAt: Date): Promise<void>;
  /**
   * Record that a tx has been confirmed on-chain. Inserts/merges the entry under its tx hash and clears any earlier
   * `pending` entry that was keyed by an identifier in the supplied set.
   */
  gotFinalized(entry: FinalizedEntryInput<T>): Promise<void>;
  /**
   * Record that a tx will not land — failed, partial-success, TTL-expired, or otherwise reverted. The storage derives
   * the entry key from the tx itself, matching the keying used by `gotPending` so the lifecycle transition is
   * in-place.
   */
  gotRejected(tx: TransactionRef, rejectedAt: Date, reason?: string): Promise<void>;
}

/**
 * Combined read + write storage interface for transaction history entries keyed by their `hash` property.
 *
 * Lifecycle (pending → finalized | rejected) is carried on the entry's `lifecycle` field, but transitions are performed
 * via the typed `gotPending` / `gotFinalized` / `gotRejected` methods on {@link TransactionHistoryWriter} — not by
 * hand-rolling the entry shape. This keeps the lifecycle vocabulary centralised and prevents call sites from drifting
 * back to ad-hoc `upsert + findByIdentifiers + delete` triples.
 *
 * Generic parameters:
 *
 * - `TRead` (the reader's view) covers the full lifecycle union (pending, finalized, rejected). Most callers only need to
 *   specify this — `Storage<WalletEntry>` is the typical shape.
 * - `TFinalized` (the writer's `gotFinalized` input shape) defaults to whichever arm of `TRead` is finalized via
 *   `Extract<TRead, FinalizedTransactionHistoryCommon>`, so it normally doesn't need to be supplied explicitly.
 *
 * Pass a full entry schema to the implementation constructor to enable serialization.
 *
 * For variance reasons, consumers that only read OR only write should depend on the narrower
 * {@link TransactionHistoryReader} / {@link TransactionHistoryWriter} interfaces directly.
 */
export interface TransactionHistoryStorage<
  TRead extends { hash: TransactionHash } = TransactionHistoryCommon,
  TFinalized extends FinalizedTransactionHistoryCommon = Extract<TRead, FinalizedTransactionHistoryCommon>,
>
  extends TransactionHistoryReader<TRead>, TransactionHistoryWriter<TFinalized> {}
