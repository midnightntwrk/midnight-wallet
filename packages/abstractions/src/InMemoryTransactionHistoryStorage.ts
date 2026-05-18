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
    this.#clearPendingByIdentifiers((rest as { identifiers?: readonly string[] }).identifiers ?? [], entry.hash);
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
    return Promise.resolve(JSON.stringify(encode(allEntries)));
  }

  static restore<T extends TransactionHistoryEntryCommon, Encoded>(
    serialized: SerializedTransactionHistory,
    schema: Schema.Schema<T, Encoded>,
    merge?: (existing: T, incoming: T) => T,
  ): InMemoryTransactionHistoryStorage<T, Encoded> {
    const decode = Schema.decodeUnknownSync(Schema.Array(schema));
    const decoded = decode(JSON.parse(serialized));
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
    const match = [...this.#storage.values()].find((entry) => {
      const ids = (entry as { identifiers?: readonly string[] }).identifiers;
      const lifecycle = (entry as { lifecycle?: { status?: string } }).lifecycle;
      return (
        Array.isArray(ids) &&
        ids.length > 0 &&
        ids.every((id: string) => provided.has(id)) &&
        lifecycle?.status === 'pending' &&
        entry.hash !== newHash
      );
    });
    if (match) {
      this.#storage.delete(match.hash);
    }
  }
}
