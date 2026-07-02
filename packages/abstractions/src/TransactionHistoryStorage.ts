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

export type PendingLifecycle = Schema.Schema.Type<typeof PendingLifecycleSchema>;

export const FinalizedBlockSchema = Schema.Struct({
  hash: Schema.String,
  height: Schema.Number,
  timestamp: Schema.Date,
});

export type FinalizedBlock = Schema.Schema.Type<typeof FinalizedBlockSchema>;

export const FinalizedLifecycleSchema = Schema.Struct({
  status: Schema.Literal('finalized'),
  finalizedBlock: FinalizedBlockSchema,
});

export type FinalizedLifecycle = Schema.Schema.Type<typeof FinalizedLifecycleSchema>;

export const RejectedLifecycleSchema = Schema.Struct({
  status: Schema.Literal('rejected'),
  rejectedAt: Schema.Date,
  reason: Schema.optional(Schema.String),
});

export type RejectedLifecycle = Schema.Schema.Type<typeof RejectedLifecycleSchema>;

/**
 * Lifecycle states a transaction history entry can be in. The `status` literal is the discriminator; the rest of the
 * entry's data is the same shape regardless of lifecycle (see {@link TransactionHistoryEntryCommonSchema}).
 */
export const TransactionLifecycleSchema = Schema.Union(
  PendingLifecycleSchema,
  FinalizedLifecycleSchema,
  RejectedLifecycleSchema,
);

export type TransactionLifecycle = Schema.Schema.Type<typeof TransactionLifecycleSchema>;

/**
 * The common shape of every transaction history entry, regardless of lifecycle. The `lifecycle` field is the only thing
 * that distinguishes pending / finalized / rejected entries — every other field belongs to all variants.
 *
 * Fields that fill in over time (`protocolVersion`, `status`, `timestamp`, `fees`) are optional because they aren't
 * known at submission time; they get populated once the chain confirms the tx. `identifiers` is required because every
 * tx has identifiers and the storage's pending-clear logic depends on them.
 *
 * Wallet packages extend this shape with their own sections (`shielded`, `unshielded`, `dust`).
 */
export const TransactionHistoryEntryCommonSchema = Schema.Struct({
  hash: TransactionHashSchema,
  identifiers: Schema.Array(Schema.String),
  protocolVersion: Schema.optional(Schema.Number),
  status: Schema.optional(TransactionHistoryStatusSchema),
  timestamp: Schema.optional(Schema.Date),
  fees: Schema.optional(Schema.NullOr(Schema.BigInt)),
  lifecycle: TransactionLifecycleSchema,
});

export type TransactionHistoryEntryCommon = Schema.Schema.Type<typeof TransactionHistoryEntryCommonSchema>;

/**
 * Build a transaction-history entry schema by extending {@link TransactionHistoryEntryCommonSchema} with wallet-specific
 * fields. This is the canonical way to declare a wallet package's entry schema — it keeps the common fields in one
 * place and makes "the entry is `common × extension`" explicit at the type level.
 *
 * @example
 *   ```ts
 *   export const DustTransactionHistoryEntrySchema = extendEntrySchema({
 *     dust: Schema.optional(DustSectionSchema),
 *   });
 *   ```;
 */
export const extendEntrySchema = <Ext extends Schema.Struct.Fields>(
  extensionFields: Ext,
): Schema.Struct<typeof TransactionHistoryEntryCommonSchema.fields & Ext> =>
  Schema.Struct({
    ...TransactionHistoryEntryCommonSchema.fields,
    ...extensionFields,
  });

/** The common entry, narrowed to its pending lifecycle. Useful in writer-input positions and predicates. */
export type PendingTransactionHistoryCommon = TransactionHistoryEntryCommon & {
  readonly lifecycle: PendingLifecycle;
};

/** The common entry, narrowed to its finalized lifecycle. Used by `gotFinalized`'s input type. */
export type FinalizedTransactionHistoryCommon = TransactionHistoryEntryCommon & {
  readonly lifecycle: FinalizedLifecycle;
};

/** The common entry, narrowed to its rejected lifecycle. */
export type RejectedTransactionHistoryCommon = TransactionHistoryEntryCommon & {
  readonly lifecycle: RejectedLifecycle;
};

export type SerializedTransactionHistory = string;

/**
 * An entry with common fields plus any additional properties (wallet sections). Used by wallet packages for
 * projection/filtering when the exact type is not known.
 */
export type TransactionHistoryEntryWithHash = TransactionHistoryEntryCommon & Record<string, unknown>;

/**
 * Input for `gotPending` — the entry minus its `lifecycle` field, which the storage attaches itself. Carries
 * `submittedAt` directly so callers don't construct the lifecycle object. `T` is the entry shape including any
 * wallet-specific extensions (e.g. `shielded`, `dust`).
 */
export type PendingEntryInput<T extends TransactionHistoryEntryCommon = TransactionHistoryEntryCommon> = Omit<
  T,
  'lifecycle'
> & { readonly submittedAt: Date };

/**
 * Input for `gotFinalized` — the entry minus its `lifecycle` field, which the storage attaches itself. Carries
 * `finalizedBlock` directly so callers don't construct the lifecycle object. `T` is the entry shape including any
 * wallet-specific extensions (e.g. `shielded`, `dust`).
 */
export type FinalizedEntryInput<T extends TransactionHistoryEntryCommon = TransactionHistoryEntryCommon> = Omit<
  T,
  'lifecycle'
> & { readonly finalizedBlock: FinalizedBlock };

/**
 * Input for `gotRejected` — the entry minus its `lifecycle` field, which the storage attaches itself. Carries
 * `rejectedAt` and the optional `reason` directly so callers don't construct the lifecycle object.
 */
export type RejectedEntryInput<T extends TransactionHistoryEntryCommon = TransactionHistoryEntryCommon> = Omit<
  T,
  'lifecycle'
> & { readonly rejectedAt: Date; readonly reason?: string };

/**
 * Read-side of a transaction history storage. T appears only in output position, so this interface is **covariant** in
 * T: a `TransactionHistoryReader<Specific>` is assignable to `TransactionHistoryReader<Wider>`.
 */
export interface TransactionHistoryReader<T extends { hash: TransactionHash } = TransactionHistoryEntryCommon> {
  getAll(): Promise<readonly T[]>;
  get(hash: TransactionHash): Promise<T | undefined>;
  serialize(): Promise<SerializedTransactionHistory>;
}

/**
 * Write-side of a transaction history storage. Exposes lifecycle-aware methods — `gotPending`, `gotFinalized`,
 * `gotRejected`. Underlying primitives (upsert / delete / find-by-identifiers) are implementation details and are not
 * part of the public contract.
 *
 * Each `got*` method records a transaction-history entry. Per the schema, every entry has `T` (the data, including any
 * wallet-specific sections) and a `lifecycle` (the discriminator); each method takes a `T`-shaped input and the storage
 * attaches the lifecycle field. Implementations are responsible for keeping the storage internally consistent across
 * keys (in particular: clearing a prior `pending` entry keyed by an identifier when its `finalized` or `rejected`
 * counterpart arrives keyed by the tx hash).
 *
 * `T` appears only in input position, so this interface is **contravariant** in T: a `TransactionHistoryWriter<Wider>`
 * is assignable to `TransactionHistoryWriter<Narrower>`.
 */
export interface TransactionHistoryWriter<T extends TransactionHistoryEntryCommon = TransactionHistoryEntryCommon> {
  /** Record that a tx has been submitted and is awaiting confirmation. */
  gotPending(entry: PendingEntryInput<T>): Promise<void>;
  /**
   * Record that a tx has been confirmed on-chain. Inserts/merges the entry under its tx hash and clears any earlier
   * `pending` entry whose identifiers are contained in this entry's identifier set.
   */
  gotFinalized(entry: FinalizedEntryInput<T>): Promise<void>;
  /**
   * Record that a tx will not land — failed, partial-success, TTL-expired, or otherwise reverted. Keyed the same way as
   * `gotPending` so the lifecycle transition is in-place.
   */
  gotRejected(entry: RejectedEntryInput<T>): Promise<void>;
}

/**
 * Combined read + write storage interface for transaction history entries keyed by their `hash` property.
 *
 * Lifecycle (pending → finalized | rejected) is carried on the entry's `lifecycle` field, but transitions are performed
 * via the typed `gotPending` / `gotFinalized` / `gotRejected` methods on {@link TransactionHistoryWriter} — not by
 * hand-rolling the entry shape. This keeps the lifecycle vocabulary centralised and prevents call sites from drifting
 * back to ad-hoc `upsert + findByIdentifiers + delete` triples.
 *
 * `T` is the entry shape (a `TransactionHistoryEntryCommon` extension carrying any wallet-specific sections). The
 * reader returns `T` (with whichever lifecycle a given entry happens to be in); the writer accepts `T`-shaped finalized
 * inputs.
 *
 * Pass a full entry schema to the implementation constructor to enable serialization.
 *
 * For variance reasons, consumers that only read OR only write should depend on the narrower
 * {@link TransactionHistoryReader} / {@link TransactionHistoryWriter} interfaces directly.
 */
export interface TransactionHistoryStorage<T extends TransactionHistoryEntryCommon = TransactionHistoryEntryCommon>
  extends TransactionHistoryReader<T>, TransactionHistoryWriter<T> {}
