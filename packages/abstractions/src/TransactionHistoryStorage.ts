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

/**
 * Constraint for transaction history entries: they must have a `hash` property
 * of type TransactionHash, which is used as the key for storage (e.g. in
 * InMemoryTransactionHistoryStorage).
 */
export type TransactionHistoryEntryWithHash = { hash: TransactionHash };

/**
 * Storage interface for transaction history entries keyed by their `hash` property.
 */
export interface TransactionHistoryStorage {
  create(entry: TransactionHistoryEntryWithHash): Promise<void>;
  delete(hash: TransactionHash): Promise<TransactionHistoryEntryWithHash | undefined>;
  getAll(): AsyncIterableIterator<TransactionHistoryEntryWithHash>;
  get(hash: TransactionHash): Promise<TransactionHistoryEntryWithHash | undefined>;
}

/**
 * Wraps any TransactionHistoryStorage to scope all operations to a given namespace
 * string. This prevents hash key collisions when multiple wallet types share a single
 * backing store — each namespace's entries are stored under keys of the form
 * `"${namespace}:${hash}"` and the original hash is restored transparently on reads.
 */
export class NamespacedTransactionHistoryStorage implements TransactionHistoryStorage {
  readonly #prefix: string;
  readonly #storage: TransactionHistoryStorage;

  constructor(namespace: string, storage: TransactionHistoryStorage) {
    this.#prefix = `${namespace}:`;
    this.#storage = storage;
  }

  #namespacedHash(hash: TransactionHash): TransactionHash {
    return `${this.#prefix}${hash}`;
  }

  #stripPrefix(entry: TransactionHistoryEntryWithHash): TransactionHistoryEntryWithHash {
    return { ...entry, hash: entry.hash.startsWith(this.#prefix) ? entry.hash.slice(this.#prefix.length) : entry.hash };
  }

  create(entry: TransactionHistoryEntryWithHash): Promise<void> {
    return this.#storage.create({ ...entry, hash: this.#namespacedHash(entry.hash) });
  }

  delete(hash: TransactionHash): Promise<TransactionHistoryEntryWithHash | undefined> {
    return this.#storage
      .delete(this.#namespacedHash(hash))
      .then((entry) => (entry ? this.#stripPrefix(entry) : undefined));
  }

  async *getAll(): AsyncIterableIterator<TransactionHistoryEntryWithHash> {
    for await (const entry of this.#storage.getAll()) {
      if (entry.hash.startsWith(this.#prefix)) {
        yield this.#stripPrefix(entry);
      }
    }
  }

  get(hash: TransactionHash): Promise<TransactionHistoryEntryWithHash | undefined> {
    return this.#storage
      .get(this.#namespacedHash(hash))
      .then((entry) => (entry ? this.#stripPrefix(entry) : undefined));
  }
}
