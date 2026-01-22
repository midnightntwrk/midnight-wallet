// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
  type TransactionHistoryStorage,
  TransactionHistoryEntrySchema,
  type TransactionHistoryEntry,
  type TransactionHash,
} from './TransactionHistoryStorage.js';

const TransactionHistorySchema = Schema.Map({
  key: Schema.String,
  value: TransactionHistoryEntrySchema,
});

export type TransactionHistory = Schema.Schema.Type<typeof TransactionHistorySchema>;

const TransactionHistoryEncoder = Schema.encodeSync(TransactionHistorySchema);
const TransactionHistoryDecoder = Schema.decodeUnknownEither(TransactionHistorySchema);

/**
 * In-memory implementation of the TransactionHistoryStorage interface.
 *
 * TODO: Implement update method with callback api when needed in the future
 */
export class InMemoryTransactionHistoryStorage implements TransactionHistoryStorage {
  private entries: TransactionHistory;

  constructor(entries?: TransactionHistory) {
    this.entries = entries || new Map<TransactionHash, TransactionHistoryEntry>();
  }

  create(entry: TransactionHistoryEntry): Promise<void> {
    this.entries.set(entry.hash, entry);
    return Promise.resolve();
  }

  delete(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> {
    const existingEntry = this.entries.get(hash);

    if (!existingEntry) {
      return Promise.resolve(undefined);
    }

    this.entries.delete(hash);

    return Promise.resolve(existingEntry);
  }

  async *getAll(): AsyncIterableIterator<TransactionHistoryEntry> {
    for (const entry of this.entries.values()) {
      yield await Promise.resolve(entry);
    }
  }

  get(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> {
    return Promise.resolve(this.entries.get(hash));
  }

  serialize(): string {
    const result = TransactionHistoryEncoder(this.entries);

    return JSON.stringify(result);
  }

  reset(): void {
    this.entries.clear();
  }

  static fromSerialized(serializedHistory: string): InMemoryTransactionHistoryStorage {
    const schema = JSON.parse(serializedHistory) as unknown;

    const decoded = Either.getOrElse(TransactionHistoryDecoder(schema), (error) => {
      throw new Error(`Failed to decode transaction history: ${error.message}`);
    });

    return new InMemoryTransactionHistoryStorage(decoded);
  }
}
