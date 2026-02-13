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
import { Schema } from 'effect';
import {
  type TransactionHistoryStorage,
  type TransactionHash,
  type TransactionHistoryEntryWithHash,
} from './TransactionHistoryStorage.js';

/**
 * In-memory implementation of the TransactionHistoryStorage interface.
 * Uses `entry.hash` as the key for storage.
 *
 * For custom entry types, provide a schema for serialize/fromSerialized to work.
 * When using the default TransactionHistoryEntry, no schema is required.
 *
 * TODO: Implement update method with callback api when needed in the future
 */
export class InMemoryTransactionHistoryStorage<
  T extends TransactionHistoryEntryWithHash,
> implements TransactionHistoryStorage<T> {
  private entries: Map<TransactionHash, T>;
  private readonly schema: Schema.Schema<T> | undefined;

  constructor(entries?: Map<TransactionHash, T>, schema?: Schema.Schema<T>) {
    this.entries = entries ?? new Map<TransactionHash, T>();
    this.schema = schema;
  }

  blablax(): void {
    console.log('blabla');
  }

  create(entry: T): Promise<void> {
    // TODO IAN - This might be wrong, even though we are appending, the top level items like status, protocolVersion might be
    // different... So merging of the receviedCoins and spentCoins might be the right approach - the others - unsure at the moment.
    // TODO IAN - yep this is WRONG anyway as it not deep merging, but it doesn't matter right now
    // for our test, we are just incterested in the HASHES (key)

    const existingEntry = this.entries.get(entry.hash);

    if (existingEntry) {
      console.log('I am merging the entry here...');
      this.entries.set(entry.hash, { ...existingEntry, ...entry });
    } else {
      console.log('I am setting the entry here...');
      this.entries.set(entry.hash, entry);
    }

    // this.entries.set(entry.hash, entry);
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

  // TODO IAN - Serialization / deserialization is wallet-specific because
  // different wallets have different schemas for their history entries.
  // If/when we need persistence here, introduce a small adapter in each wallet
  // package that knows how to (de)serialize its own entry type.

  // Because it will have specific schemas that are wallet depenedent|!!!

  // serialize(): string {
  //   const schemaToUse = this.schema ?? (TransactionHistoryEntrySchema as Schema.Schema<T>);
  //   const mapSchema = Schema.Map({ key: Schema.String, value: schemaToUse });
  //   const encoder = Schema.encodeSync(mapSchema);
  //   const result = encoder(this.entries);
  //   return JSON.stringify(result);
  // }

  // reset(): void {
  //   this.entries.clear();
  // }

  // static fromSerialized(serializedHistory: string): InMemoryTransactionHistoryStorage<TransactionHistoryEntry>;
  // static fromSerialized<T extends TransactionHistoryEntryWithHash>(
  //   serializedHistory: string,
  //   schema: Schema.Schema<T>,
  // ): InMemoryTransactionHistoryStorage<T>;
  // static fromSerialized<T extends TransactionHistoryEntryWithHash>(
  //   serializedHistory: string,
  //   schema?: Schema.Schema<T>,
  // ): InMemoryTransactionHistoryStorage<T> {
  //   const schemaToUse = schema ?? (TransactionHistoryEntrySchema as Schema.Schema<T>);
  //   const mapSchema = Schema.Map({ key: Schema.String, value: schemaToUse });
  //   const decoder = Schema.decodeUnknownEither(mapSchema);

  //   const parsed = JSON.parse(serializedHistory) as unknown;
  //   const decoded = Either.getOrElse(decoder(parsed), (error) => {
  //     throw new Error(`Failed to decode transaction history: ${error.message}`);
  //   });

  //   return new InMemoryTransactionHistoryStorage<T>(decoded, schemaToUse);
  // }
}
