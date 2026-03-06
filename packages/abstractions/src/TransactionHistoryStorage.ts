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

export const TransactionHashSchema = Schema.String;

export type TransactionHash = Schema.Schema.Type<typeof TransactionHashSchema>;

/**
 * Constraint for transaction history entries: they must have a `hash` property
 * of type TransactionHash, which is used as the key for storage (e.g. in
 * InMemoryTransactionHistoryStorage).
 */
export type TransactionHistoryEntryWithHash = { hash: TransactionHash };

/**
 * Storage interface for transaction history. Generic over the entry shape,
 * with the constraint that entries must have a `hash` property (used as key).
 */
export interface TransactionHistoryStorage<T extends TransactionHistoryEntryWithHash> {
  create(entry: T, mergeEntries?: (existing: T, incoming: T) => T): Promise<void>;
  delete(hash: TransactionHash): Promise<T | undefined>;
  getAll(): AsyncIterableIterator<T>;
  get(hash: TransactionHash): Promise<T | undefined>;
}
