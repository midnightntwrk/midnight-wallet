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
import {
  type TransactionHistoryStorage,
  type TransactionHash,
  type TransactionHistoryEntryWithHash,
} from './TransactionHistoryStorage.js';

/**
 * In-memory implementation of the TransactionHistoryStorage interface.
 */
export class InMemoryTransactionHistoryStorage<
  T extends TransactionHistoryEntryWithHash,
> implements TransactionHistoryStorage<T> {
  private entries: Map<TransactionHash, T>;

  constructor(entries?: Map<TransactionHash, T>) {
    this.entries = entries ?? new Map<TransactionHash, T>();
  }

  create(entry: T, mergeEntries?: (existing: T, incoming: T) => T): Promise<void> {
    const existingEntry = this.entries.get(entry.hash);

    if (existingEntry) {
      this.entries.set(entry.hash, mergeEntries ? mergeEntries(existingEntry, entry) : entry);
    } else {
      this.entries.set(entry.hash, entry);
    }

    return Promise.resolve();
  }

  delete(hash: TransactionHash): Promise<T | undefined> {
    const existingEntry = this.entries.get(hash);

    if (!existingEntry) {
      return Promise.resolve(undefined);
    }

    this.entries.delete(hash);

    return Promise.resolve(existingEntry);
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
}
