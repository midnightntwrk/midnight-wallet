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
import {
  type TransactionHistoryStorage,
  type TransactionHash,
  type TransactionHistoryEntryCommon,
  type PendingEntryInput,
  type FinalizedEntryInput,
  type RejectedEntryInput,
  type SerializedTransactionHistory,
} from './TransactionHistoryStorage.js';

/**
 * On-disk version of the serialized tx-history envelope. Bumped whenever the persisted format changes in a way
 * `restore` must migrate from. v1 wraps the entries in `{ version, entries }` and requires a `lifecycle` on every
 * entry; pre-v1 payloads (abstractions ≤ 2.1.0) are bare arrays whose entries have no `lifecycle` and may omit
 * `identifiers`.
 */
const CURRENT_SCHEMA_VERSION = 1;

type SerializedEnvelope = { readonly version: number; readonly entries: readonly unknown[] };

const isEnvelope = (parsed: unknown): parsed is SerializedEnvelope =>
  typeof parsed === 'object' &&
  parsed !== null &&
  !Array.isArray(parsed) &&
  Array.isArray((parsed as { entries?: unknown }).entries);

/** Pull the entry list out of either a v1 `{ version, entries }` envelope or a pre-v1 bare array. */
const extractEncodedEntries = (parsed: unknown): readonly unknown[] => {
  if (Array.isArray(parsed)) return parsed;
  if (isEnvelope(parsed)) return parsed.entries;
  throw new Error(
    'Unrecognized transaction history payload: expected a JSON array (pre-v1) or a { version, entries } envelope',
  );
};

// NOTE: pre-lifecycle entries never persisted a block hash/height, so a synthesized `finalized`
// lifecycle uses a sentinel block (empty hash, height 0) and the entry's own timestamp. The
// historical `status`/`timestamp`/`fees` fields stay optional in the current schema and are retained
// untouched — only the new `lifecycle` discriminator (and `identifiers`, if absent) is inferred. If a
// real block ever needs backfilling, do it from the indexer, not here.
const EPOCH_ISO = new Date(0).toISOString();

const synthesizeEncodedLifecycle = (raw: Record<string, unknown>): Record<string, unknown> => {
  const at = typeof raw['timestamp'] === 'string' ? raw['timestamp'] : EPOCH_ISO;
  return raw['status'] === 'FAILURE'
    ? { status: 'rejected', rejectedAt: at }
    : { status: 'finalized', finalizedBlock: { hash: '', height: 0, timestamp: at } };
};

/**
 * Migrate a single ENCODED (JSON) entry to the current schema's encoded shape. Idempotent: entries that already carry a
 * `lifecycle` (v1 payloads) pass through untouched. Pre-`lifecycle` entries get a lifecycle synthesized from their
 * `status`/`timestamp`, and an empty `identifiers` when absent.
 */
const migrateEncodedEntry = (raw: unknown): unknown => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw; // let the schema reject non-objects
  // Cast required because: indexing an `object` by string needs a record type; the runtime guard
  // above has already established `raw` is a non-null, non-array object.
  const entry = raw as Record<string, unknown>;
  return {
    ...entry,
    identifiers: Array.isArray(entry['identifiers']) ? entry['identifiers'] : [],
    lifecycle: entry['lifecycle'] ?? synthesizeEncodedLifecycle(entry),
  };
};

/**
 * In-memory implementation of the TransactionHistoryStorage interface.
 *
 * `T` is the entry shape — a {@link TransactionHistoryEntryCommon} extension carrying any wallet-specific sections. The
 * reader returns `T` (with whichever lifecycle a given entry happens to be in); each writer method accepts a `T`-shaped
 * input minus its `lifecycle` field, and the storage attaches the appropriate lifecycle.
 *
 * An optional `merge` function controls how an incoming write combines with an existing entry under the same hash.
 * Default is a shallow spread (`{ ...existing, ...incoming }`).
 *
 * Because the merge runs **synchronously** inside the lifecycle methods, the single-threaded nature of JavaScript
 * guarantees atomicity — no external semaphore is needed.
 */
export class InMemoryTransactionHistoryStorage<
  T extends TransactionHistoryEntryCommon = TransactionHistoryEntryCommon,
  // `Encoded` is the schema's encoded-side type. It's a class generic (not an interface generic) because
  // `Schema.Schema<A, I>` is invariant in `I`, so the encoded form has to be inferred at construction time from the
  // schema argument. Callers don't usually supply this — TypeScript infers it from `schema`.
  Encoded = T,
> implements TransactionHistoryStorage<T> {
  #storage: Map<TransactionHash, T>;
  readonly #schema: Schema.Schema<T, Encoded>;
  readonly #merge: (existing: T, incoming: T) => T;

  constructor(schema: Schema.Schema<T, Encoded>, merge?: (existing: T, incoming: T) => T) {
    this.#storage = new Map<TransactionHash, T>();
    this.#schema = schema;
    this.#merge = merge ?? ((existing, incoming) => ({ ...existing, ...incoming }));
  }

  async gotPending(input: PendingEntryInput<T>): Promise<void> {
    const { submittedAt, ...rest } = input;
    const entry = { ...rest, lifecycle: { status: 'pending', submittedAt } } as unknown as T;
    await this.#upsert(entry);
  }

  async gotFinalized(input: FinalizedEntryInput<T>): Promise<void> {
    const { finalizedBlock, ...rest } = input;
    const entry = { ...rest, lifecycle: { status: 'finalized', finalizedBlock } } as unknown as T;
    await this.#upsert(entry);
    this.#clearPendingByIdentifiers(entry.identifiers, entry.hash);
  }

  async gotRejected(input: RejectedEntryInput<T>): Promise<void> {
    const { rejectedAt, reason, ...rest } = input;
    const lifecycle =
      reason !== undefined
        ? { status: 'rejected' as const, rejectedAt, reason }
        : { status: 'rejected' as const, rejectedAt };
    const entry = { ...rest, lifecycle } as unknown as T;
    await this.#upsert(entry);
  }

  getAll(): Promise<readonly T[]> {
    return Promise.resolve([...this.#storage.values()]);
  }

  get(hash: TransactionHash): Promise<T | undefined> {
    return Promise.resolve(this.#storage.get(hash));
  }

  reset(): void {
    this.#storage.clear();
  }

  serialize(): Promise<SerializedTransactionHistory> {
    const allEntries = [...this.#storage.values()];
    const encode = Schema.encodeSync(Schema.Array(this.#schema));
    const envelope: SerializedEnvelope = { version: CURRENT_SCHEMA_VERSION, entries: encode(allEntries) };
    return Promise.resolve(JSON.stringify(envelope));
  }

  static restore<T extends TransactionHistoryEntryCommon, Encoded>(
    serialized: SerializedTransactionHistory,
    schema: Schema.Schema<T, Encoded>,
    merge?: (existing: T, incoming: T) => T,
  ): InMemoryTransactionHistoryStorage<T, Encoded> {
    // Accept both the v1 envelope and pre-v1 bare arrays, migrating each entry (synthesize
    // `lifecycle`/`identifiers` when absent) BEFORE decoding, so payloads written by abstractions
    // ≤ 2.1.0 — which predate the required `lifecycle` field — still load.
    const migrated = extractEncodedEntries(JSON.parse(serialized)).map(migrateEncodedEntry);
    const decode = Schema.decodeUnknownSync(Schema.Array(schema));
    const decoded = decode(migrated);
    const storage = new InMemoryTransactionHistoryStorage<T, Encoded>(schema, merge);
    for (const entry of decoded) {
      storage.#storage.set(entry.hash, entry);
    }
    return storage;
  }

  #upsert(entry: T): Promise<void> {
    const existing = this.#storage.get(entry.hash);
    this.#storage.set(entry.hash, existing ? this.#merge(existing, entry) : entry);
    return Promise.resolve();
  }

  #clearPendingByIdentifiers(identifiers: readonly string[], newHash: TransactionHash): void {
    if (identifiers.length === 0) return;
    const provided = new Set<string>(identifiers);
    const match = [...this.#storage.values()].find(
      (entry) =>
        entry.identifiers.length > 0 &&
        entry.identifiers.every((id) => provided.has(id)) &&
        entry.lifecycle.status === 'pending' &&
        entry.hash !== newHash,
    );
    if (match) {
      this.#storage.delete(match.hash);
    }
  }
}
