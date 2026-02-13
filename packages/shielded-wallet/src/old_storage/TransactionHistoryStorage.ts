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

const TransactionHashSchema = Schema.String;

export type TransactionHash = Schema.Schema.Type<typeof TransactionHashSchema>;

/** Schema for a single coin in received/spent lists (QualifiedShieldedCoinInfo from ledger) */
export const QualifiedShieldedCoinInfoSchema = Schema.Struct({
  type: Schema.String,
  nonce: Schema.String,
  value: Schema.BigInt,
  mt_index: Schema.BigInt,
});

export type QualifiedShieldedCoinInfo = Schema.Schema.Type<typeof QualifiedShieldedCoinInfoSchema>;

export const TransactionHistoryEntrySchema = Schema.Struct({
  hash: TransactionHashSchema,
  protocolVersion: Schema.Number,
  status: Schema.Literal('SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS'),
  receivedCoins: Schema.Array(QualifiedShieldedCoinInfoSchema),
  spentCoins: Schema.Array(QualifiedShieldedCoinInfoSchema),
});

export type TransactionHistoryEntry = Schema.Schema.Type<typeof TransactionHistoryEntrySchema>;

// Move to abstraction...
//TODO IAN

// Own implmentation for each wallet using the same interface !

export interface TransactionHistoryStorage {
  create(entry: TransactionHistoryEntry): Promise<void>;
  delete(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined>;
  getAll(): AsyncIterableIterator<TransactionHistoryEntry>;
  get(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined>;
}
