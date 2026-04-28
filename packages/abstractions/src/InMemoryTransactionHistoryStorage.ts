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
  type PendingTransactionHistoryCommon,
  type SerializedTransactionHistory,
} from './TransactionHistoryStorage.js';

/**
 * In-memory implementation of the TransactionHistoryStorage interface.
 *
 * An optional `merge` function can be provided to control how existing and incoming entries are combined during
 * {@link upsert}. When omitted the default behaviour is a shallow spread (`{ ...existing, ...incoming }`).
 *
 * Because the merge runs **synchronously** inside `upsert`, the single-threaded nature of JavaScript guarantees
 * atomicity — no external semaphore is needed.
 */
export class InMemoryTransactionHistoryStorage<
  T extends { hash: TransactionHash } = TransactionHistoryCommon,
  I = T,
  P extends { hash: TransactionHash; identifiers: readonly string[] } = PendingTransactionHistoryCommon,
> implements TransactionHistoryStorage<T, P> {
  private storage: Map<TransactionHash, T>;
  private pendingStorage: Map<TransactionHash, P>;
  private readonly schema: Schema.Schema<T, I>;
  private readonly merge: (existing: T, incoming: T) => T;

  constructor(schema: Schema.Schema<T, I>, merge?: (existing: T, incoming: T) => T) {
    this.storage = new Map<TransactionHash, T>();
    this.pendingStorage = new Map<TransactionHash, P>();
    this.schema = schema;
    this.merge = merge ?? ((existing, incoming) => ({ ...existing, ...incoming }));
  }

  upsert(entry: T): Promise<void> {
    const existing = this.storage.get(entry.hash);
    this.storage.set(entry.hash, existing ? this.merge(existing, entry) : entry);
    return Promise.resolve();
  }

  getAll(): Promise<readonly T[]> {
    return Array.fromAsync(this.storage.values());
  }

  get(hash: TransactionHash): Promise<T | undefined> {
    return Promise.resolve(this.storage.get(hash));
  }

  upsertPending(entry: P): Promise<void> {
    this.pendingStorage.set(entry.hash, entry);
    return Promise.resolve();
  }

  getPending(hash: TransactionHash): Promise<P | undefined> {
    return Promise.resolve(this.pendingStorage.get(hash));
  }

  getAllPending(): Promise<readonly P[]> {
    return Promise.resolve([...this.pendingStorage.values()]);
  }

  deletePending(hash: TransactionHash): Promise<void> {
    this.pendingStorage.delete(hash);
    return Promise.resolve();
  }

  findPendingMatching(identifiers: readonly string[]): Promise<P | undefined> {
    const provided = new Set(identifiers);
    const match = [...this.pendingStorage.values()].find(
      (entry) => entry.identifiers.length > 0 && entry.identifiers.every((id) => provided.has(id)),
    );
    return Promise.resolve(match);
  }

  reset(): void {
    this.storage.clear();
    this.pendingStorage.clear();
  }

  async serialize(): Promise<SerializedTransactionHistory> {
    const allEntries = await this.getAll();
    const encode = Schema.encodeSync(Schema.Array(this.schema));
    return JSON.stringify(encode([...allEntries]));
  }

  static restore<
    T extends { hash: string },
    I,
    P extends { hash: TransactionHash; identifiers: readonly string[] } = PendingTransactionHistoryCommon,
  >(
    serialized: SerializedTransactionHistory,
    schema: Schema.Schema<T, I>,
    merge?: (existing: T, incoming: T) => T,
  ): InMemoryTransactionHistoryStorage<T, I, P> {
    const decode = Schema.decodeUnknownSync(Schema.Array(schema));
    const decoded = decode(JSON.parse(serialized));
    const storage = new InMemoryTransactionHistoryStorage<T, I, P>(schema, merge);
    for (const entry of decoded) {
      storage.storage.set(entry.hash, entry);
    }
    return storage;
  }
}
