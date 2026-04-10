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
  type SerializedTransactionHistory,
} from './TransactionHistoryStorage.js';

/**
 * In-memory implementation of the TransactionHistoryStorage interface.
 *
 * An optional `merge` function can be provided to control how existing and
 * incoming entries are combined during {@link upsert}.  When omitted the
 * default behaviour is a shallow spread (`{ ...existing, ...incoming }`).
 *
 * Because the merge runs **synchronously** inside `upsert`, the single-threaded
 * nature of JavaScript guarantees atomicity — no external semaphore is needed.
 */
export class InMemoryTransactionHistoryStorage<
  T extends { hash: TransactionHash } = TransactionHistoryCommon,
  I = T,
> implements TransactionHistoryStorage<T> {
  private storage: Map<TransactionHash, T>;
  private readonly schema: Schema.Schema<T, I>;
  private readonly merge: (existing: T, incoming: T) => T;

  constructor(schema: Schema.Schema<T, I>, merge?: (existing: T, incoming: T) => T) {
    this.storage = new Map<TransactionHash, T>();
    this.schema = schema;
    this.merge = merge ?? ((existing, incoming) => ({ ...existing, ...incoming }));
  }

  upsert(entry: T): Promise<void> {
    const existing = this.storage.get(entry.hash);
    this.storage.set(entry.hash, existing ? this.merge(existing, entry) : entry);
    return Promise.resolve();
  }

  async *getAll(): AsyncIterableIterator<T> {
    for (const entry of this.storage.values()) {
      yield await Promise.resolve(entry);
    }
  }

  get(hash: TransactionHash): Promise<T | undefined> {
    return Promise.resolve(this.storage.get(hash));
  }

  reset(): void {
    this.storage.clear();
  }

  async serialize(): Promise<SerializedTransactionHistory> {
    const allEntries: T[] = [];
    for await (const entry of this.getAll()) {
      allEntries.push(entry);
    }
    const encode = Schema.encodeSync(Schema.Array(this.schema));
    return JSON.stringify(encode(allEntries));
  }

  static restore<T extends { hash: string }, I>(
    serialized: SerializedTransactionHistory,
    schema: Schema.Schema<T, I>,
    merge?: (existing: T, incoming: T) => T,
  ): InMemoryTransactionHistoryStorage<T, I> {
    const decode = Schema.decodeUnknownSync(Schema.Array(schema));
    const decoded = decode(JSON.parse(serialized));
    const storage = new InMemoryTransactionHistoryStorage<T, I>(schema, merge);
    for (const entry of decoded) {
      storage.storage.set(entry.hash, entry);
    }
    return storage;
  }
}
