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
 */
export class InMemoryTransactionHistoryStorage<
  T extends { hash: TransactionHash } = TransactionHistoryCommon,
  I = T,
> implements TransactionHistoryStorage<T> {
  private entries: Map<TransactionHash, T>;
  private readonly entrySchema: Schema.Schema<T, I>;

  constructor(entrySchema: Schema.Schema<T, I>) {
    this.entries = new Map<TransactionHash, T>();
    this.entrySchema = entrySchema;
  }

  upsert(entry: T): Promise<void> {
    const existing = this.entries.get(entry.hash);
    this.entries.set(entry.hash, existing ? { ...existing, ...entry } : entry);
    return Promise.resolve();
  }

  async *getAll(): AsyncIterableIterator<T> {
    for (const entry of this.entries.values()) {
      yield await Promise.resolve(entry);
    }
  }

  get(hash: TransactionHash): Promise<T | undefined> {
    return Promise.resolve(this.entries.get(hash));
  }

  reset(): void {
    this.entries.clear();
  }

  async serialize(): Promise<SerializedTransactionHistory> {
    const allEntries: T[] = [];
    for await (const entry of this.getAll()) {
      allEntries.push(entry);
    }
    const encode = Schema.encodeSync(Schema.Array(this.entrySchema));
    return JSON.stringify(encode(allEntries));
  }

  static restore<T extends { hash: string }, I>(
    serialized: SerializedTransactionHistory,
    entrySchema: Schema.Schema<T, I>,
  ): InMemoryTransactionHistoryStorage<T, I> {
    const decode = Schema.decodeUnknownSync(Schema.Array(entrySchema));
    const decoded = decode(JSON.parse(serialized));
    const storage = new InMemoryTransactionHistoryStorage<T, I>(entrySchema);
    for (const entry of decoded) {
      storage.entries.set(entry.hash, entry);
    }
    return storage;
  }
}
