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
  type TransactionHistoryCommon,
  type FinalizedTransactionHistoryCommon,
  type FinalizedEntryInput,
  type SerializedTransactionHistory,
  type TransactionRef,
} from './TransactionHistoryStorage.js';

const deriveKey = (tx: TransactionRef, identifiers: readonly string[]): TransactionHash | undefined => {
  if (typeof tx.transactionHash === 'function') {
    try {
      return tx.transactionHash().toString();
    } catch {
      // fall through to identifier fallback
    }
  }
  return identifiers[0];
};

/**
 * In-memory implementation of the TransactionHistoryStorage interface.
 *
 * `TRead` is the lifecycle union returned by reads (pending | finalized | rejected). The finalized entry shape accepted
 * by `gotFinalized` is derived automatically as `Extract<TRead, FinalizedTransactionHistoryCommon>` — there's no
 * separate type parameter for it, which keeps inference at call sites simple (`new
 * InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries)` is sufficient).
 *
 * An optional `merge` function controls how an incoming write combines with an existing entry under the same hash.
 * Default is a shallow spread (`{ ...existing, ...incoming }`).
 *
 * Because the merge runs **synchronously** inside the lifecycle methods, the single-threaded nature of JavaScript
 * guarantees atomicity — no external semaphore is needed.
 */
export class InMemoryTransactionHistoryStorage<
  TRead extends { hash: TransactionHash } = TransactionHistoryCommon,
  // `Encoded` is the schema's encoded-side type. It's a class generic (not an interface generic) because
  // `Schema.Schema<A, I>` is invariant in `I`, so the encoded form has to be inferred at construction time from the
  // schema argument. Callers don't usually supply this — TypeScript infers it from `schema`.
  Encoded = TRead,
> implements TransactionHistoryStorage<TRead> {
  #storage: Map<TransactionHash, TRead>;
  readonly #schema: Schema.Schema<TRead, Encoded>;
  readonly #merge: (existing: TRead, incoming: TRead) => TRead;

  constructor(schema: Schema.Schema<TRead, Encoded>, merge?: (existing: TRead, incoming: TRead) => TRead) {
    this.#storage = new Map<TransactionHash, TRead>();
    this.#schema = schema;
    this.#merge = merge ?? ((existing, incoming) => ({ ...existing, ...incoming }));
  }

  async gotPending(tx: TransactionRef, submittedAt: Date): Promise<void> {
    const identifiers = tx.identifiers();
    const hash = deriveKey(tx, identifiers);
    if (hash === undefined) return;
    const entry = {
      hash,
      identifiers,
      lifecycle: { status: 'pending', submittedAt },
    } as unknown as TRead;
    await this.#upsert(entry);
  }

  async gotFinalized(input: FinalizedEntryInput<Extract<TRead, FinalizedTransactionHistoryCommon>>): Promise<void> {
    const { finalizedAt, ...rest } = input;
    const entry = { ...rest, lifecycle: { status: 'finalized', finalizedAt } } as unknown as TRead;
    await this.#upsert(entry);
    this.#clearPendingByIdentifiers((rest as { identifiers?: readonly string[] }).identifiers ?? [], entry.hash);
  }

  async gotRejected(tx: TransactionRef, rejectedAt: Date, reason?: string): Promise<void> {
    const identifiers = tx.identifiers();
    const hash = deriveKey(tx, identifiers);
    if (hash === undefined) return;
    const lifecycle =
      reason !== undefined
        ? { status: 'rejected' as const, rejectedAt, reason }
        : { status: 'rejected' as const, rejectedAt };
    const entry = { hash, identifiers, lifecycle } as unknown as TRead;
    await this.#upsert(entry);
  }

  getAll(): Promise<readonly TRead[]> {
    return Promise.resolve([...this.#storage.values()]);
  }

  get(hash: TransactionHash): Promise<TRead | undefined> {
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

  static restore<TRead extends { hash: TransactionHash }, Encoded>(
    serialized: SerializedTransactionHistory,
    schema: Schema.Schema<TRead, Encoded>,
    merge?: (existing: TRead, incoming: TRead) => TRead,
  ): InMemoryTransactionHistoryStorage<TRead, Encoded> {
    const decode = Schema.decodeUnknownSync(Schema.Array(schema));
    const decoded = decode(JSON.parse(serialized));
    const storage = new InMemoryTransactionHistoryStorage<TRead, Encoded>(schema, merge);
    for (const entry of decoded) {
      storage.#storage.set(entry.hash, entry);
    }
    return storage;
  }

  #upsert(entry: TRead): Promise<void> {
    // TODO Ian - Temp needs removing
    // eslint-disable-next-line no-console
    console.log(entry.hash, (entry as { lifecycle?: unknown }).lifecycle);
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
        lifecycle?.status === 'pending'
      );
    });
    if (match) {
      // TODO Ian - temp remove
      // eslint-disable-next-line no-console
      console.log('[txHistory] pending → finalized — replacing key', {
        previousHash: match.hash,
        newHash,
      });
      this.#storage.delete(match.hash);
    }
  }
}
