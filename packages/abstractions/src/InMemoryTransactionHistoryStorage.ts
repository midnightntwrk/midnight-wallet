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
import { Either, Schema } from 'effect';
import {
  CURRENT_FORMAT_VERSION,
  TRANSACTION_HISTORY_SURFACE,
  TransactionHistoryRestoreError,
  upgradeToCurrentFormat,
} from './TransactionHistoryFormat.js';
import {
  type TransactionHistoryStorage,
  type TransactionHash,
  type TransactionHistoryEntryCommon,
  type PendingEntryInput,
  type FinalizedEntryInput,
  type RejectedEntryInput,
  type SerializedTransactionHistory,
  coversTransaction,
} from './TransactionHistoryStorage.js';

/** Parse a stored payload, turning a malformed one into the same failure as any other unreadable history. */
const parseJson = (serialized: string): unknown => {
  try {
    return JSON.parse(serialized);
  } catch (cause) {
    throw new TransactionHistoryRestoreError({
      surface: TRANSACTION_HISTORY_SURFACE,
      detectedVersion: 'unrecognised',
      cause,
    });
  }
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
    this.#clearUnfinalizedCoveredBy(entry);
  }

  async gotRejected(input: RejectedEntryInput<T>): Promise<void> {
    if (this.#inclusionRecorded(input)) return;
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
    return Promise.resolve(JSON.stringify({ version: CURRENT_FORMAT_VERSION, entries: encode(allEntries) }));
  }

  /**
   * Rebuild a storage from a payload produced by {@link serialize}, in any format version this build knows.
   *
   * A payload is brought up to the current format before the entry schema sees it, so a history written by an older SDK
   * opens without the caller doing anything. A payload that cannot be read is refused with a
   * {@link TransactionHistoryRestoreError} rather than handed back as an empty storage — losing a history silently is
   * worse than failing to open it.
   *
   * @example
   *   ```ts
   *   const storage = InMemoryTransactionHistoryStorage.restore(saved, WalletEntrySchema, mergeWalletEntries);
   *   ```;
   *
   * @param serialized - The stored payload.
   * @param schema - The full entry schema, including any wallet-specific sections.
   * @param merge - How an incoming write combines with an existing entry under the same hash.
   * @returns A storage holding every entry in the payload.
   * @throws {TransactionHistoryRestoreError} When the payload is not readable JSON, was written in a format version
   *   this build does not know, or does not decode against `schema` once upgraded.
   */
  static restore<T extends TransactionHistoryEntryCommon, Encoded>(
    serialized: SerializedTransactionHistory,
    schema: Schema.Schema<T, Encoded>,
    merge?: (existing: T, incoming: T) => T,
  ): InMemoryTransactionHistoryStorage<T, Encoded> {
    const upgraded = upgradeToCurrentFormat(parseJson(serialized));
    const entries = (upgraded as { readonly entries: unknown }).entries;
    const decoded = Schema.decodeUnknownEither(Schema.Array(schema))(entries);
    return Either.match(decoded, {
      onLeft: (cause) => {
        throw new TransactionHistoryRestoreError({
          surface: TRANSACTION_HISTORY_SURFACE,
          detectedVersion: CURRENT_FORMAT_VERSION,
          cause,
        });
      },
      onRight: (values) => {
        const storage = new InMemoryTransactionHistoryStorage<T, Encoded>(schema, merge);
        values.forEach((entry) => storage.#storage.set(entry.hash, entry));
        return storage;
      },
    });
  }

  #upsert(entry: T): Promise<void> {
    const existing = this.#storage.get(entry.hash);
    this.#storage.set(entry.hash, existing ? this.#merge(existing, entry) : entry);
    return Promise.resolve();
  }

  /** Checked synchronously with the write that follows, so a verdict racing sync cannot supersede inclusion. */
  #inclusionRecorded(key: Pick<T, 'hash' | 'identifiers'>): boolean {
    return [...this.#storage.values()].some(
      (entry) => entry.lifecycle.status === 'finalized' && coversTransaction(entry, key),
    );
  }

  #clearUnfinalizedCoveredBy(finalized: T): void {
    [...this.#storage.values()]
      .filter(
        (entry) =>
          entry.lifecycle.status !== 'finalized' &&
          entry.hash !== finalized.hash &&
          coversTransaction(finalized, entry),
      )
      .forEach((entry) => this.#storage.delete(entry.hash));
  }
}
