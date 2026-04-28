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

export const TransactionHistoryStatusSchema = Schema.Literal('SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS');

export type TransactionHistoryStatus = Schema.Schema.Type<typeof TransactionHistoryStatusSchema>;

export const TransactionHistoryCommonSchema = Schema.Struct({
  hash: TransactionHashSchema,
  protocolVersion: Schema.Number,
  status: TransactionHistoryStatusSchema,
  identifiers: Schema.optional(Schema.Array(Schema.String)),
  timestamp: Schema.optional(Schema.Date),
  fees: Schema.optional(Schema.NullOr(Schema.BigInt)),
});

export type TransactionHistoryCommon = Schema.Schema.Type<typeof TransactionHistoryCommonSchema>;

export const PendingTransactionHistoryCommonSchema = Schema.Struct({
  hash: TransactionHashSchema,
  identifiers: Schema.Array(Schema.String),
  submittedAt: Schema.Date,
});

export type PendingTransactionHistoryCommon = Schema.Schema.Type<typeof PendingTransactionHistoryCommonSchema>;

export type SerializedTransactionHistory = string;

/**
 * An entry with common fields plus any additional properties (wallet sections). Used by wallet packages for
 * projection/filtering when the exact type is not known.
 */
export type TransactionHistoryEntryWithHash = TransactionHistoryCommon & Record<string, unknown>;

/**
 * Storage interface for transaction history entries keyed by their `hash` property.
 *
 * Pass a full entry schema to the implementation constructor to enable serialization.
 */
export interface TransactionHistoryStorage<
  T extends { hash: TransactionHash } = TransactionHistoryCommon,
  P extends { hash: TransactionHash; identifiers: readonly string[] } = PendingTransactionHistoryCommon,
> {
  upsert(entry: T): Promise<void>;
  getAll(): Promise<readonly T[]>;
  get(hash: TransactionHash): Promise<T | undefined>;
  serialize(): Promise<SerializedTransactionHistory>;

  upsertPending(entry: P): Promise<void>;

  getPending(hash: TransactionHash): Promise<P | undefined>;

  getAllPending(): Promise<readonly P[]>;

  deletePending(hash: TransactionHash): Promise<void>;

  findPendingMatching(identifiers: readonly string[]): Promise<P | undefined>;
}

/** Looks up a pending entry whose identifiers are covered by `identifiers` and, if found, removes it. */
export const clearPendingMatching = async <
  T extends { hash: TransactionHash },
  P extends { hash: TransactionHash; identifiers: readonly string[] },
>(
  storage: TransactionHistoryStorage<T, P>,
  identifiers: readonly string[],
  // TODO Ian — temp, remove (the `source` parameter is purely for logging)
  source: string = 'unknown',
  // TODO Ian — end temp, remove
): Promise<void> => {
  // TODO Ian — temp, remove
  const pendingBefore = await storage.getAllPending();
  // eslint-disable-next-line no-console
  console.log(`[pending-tx-history] CLEAR called by ${source}`, {
    syncIdentifiers: identifiers,
    pendingBefore: pendingBefore.map((e) => ({ key: e.hash, ids: e.identifiers })),
    expectation:
      pendingBefore.length === 0
        ? 'no match (storage empty — no in-flight txs from this wallet)'
        : 'will match if any pendingBefore entry.identifiers ⊆ syncIdentifiers',
  });
  // TODO Ian — end temp, remove
  const match = await storage.findPendingMatching(identifiers);
  // TODO Ian — temp, remove
  if (match) {
    // eslint-disable-next-line no-console
    console.log(`[pending-tx-history] CLEAR (${source}) -> match found`, {
      key: match.hash,
      matchedIdentifiers: match.identifiers,
    });
  } else {
    // eslint-disable-next-line no-console
    console.log(`[pending-tx-history] CLEAR (${source}) -> no match`);
  }
  // TODO Ian — end temp, remove

  if (match) {
    await storage.deletePending(match.hash);
    // TODO Ian — temp, remove
    // eslint-disable-next-line no-console
    console.log(`[pending-tx-history] DELETE (${source})`, { key: match.hash });
    // TODO Ian — end temp, remove
  }
};
