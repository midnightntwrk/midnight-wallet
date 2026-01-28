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
import { TransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Either, Schema } from 'effect';
import { UnshieldedUpdate } from './SyncSchema.js';

export const UnshieldedTransactionHistoryEntrySchema = Schema.Struct({
  id: Schema.Number,
  hash: TransactionHistoryStorage.TransactionHashSchema,
  protocolVersion: Schema.Number,
  identifiers: Schema.Array(Schema.String),
  timestamp: Schema.Date,
  fees: Schema.NullOr(Schema.BigInt),
  status: Schema.Literal('SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS'),
});

export type UnshieldedTransactionHistoryEntry = Schema.Schema.Type<typeof UnshieldedTransactionHistoryEntrySchema>;
export interface TransactionHistoryService<SyncUpdate> {
  create(update: SyncUpdate): Promise<void>;
  get(hash: TransactionHistoryStorage.TransactionHash): Promise<UnshieldedTransactionHistoryEntry | undefined>;
  getAll(): AsyncIterableIterator<UnshieldedTransactionHistoryEntry>;
  delete(hash: TransactionHistoryStorage.TransactionHash): Promise<UnshieldedTransactionHistoryEntry | undefined>;
  serialize(): Promise<SerializedUnshieldedTransactionHistory>;
}

export type DefaultTransactionHistoryConfiguration = {
  unshieldedTxHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<UnshieldedTransactionHistoryEntry>;
};

const convertUpdateToEntry = ({ transaction, status }: UnshieldedUpdate): UnshieldedTransactionHistoryEntry => {
  return {
    id: transaction.id,
    hash: transaction.hash,
    protocolVersion: transaction.protocolVersion,
    identifiers: transaction.identifiers ? transaction.identifiers : [],
    status,
    timestamp: transaction.block?.timestamp ?? null,
    fees: transaction.fees?.paidFees ?? null,
  };
};

export const makeDefaultTransactionHistoryService = (
  config: DefaultTransactionHistoryConfiguration,
  _getContext: () => unknown,
): TransactionHistoryService<UnshieldedUpdate> => {
  const { unshieldedTxHistoryStorage } = config;

  return {
    create: async (update: UnshieldedUpdate): Promise<void> => {
      const entry = convertUpdateToEntry(update);
      await unshieldedTxHistoryStorage.create(entry);
    },
    get: async (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Promise<UnshieldedTransactionHistoryEntry | undefined> => {
      return await unshieldedTxHistoryStorage.get(hash);
    },
    getAll: (): AsyncIterableIterator<UnshieldedTransactionHistoryEntry> => {
      return unshieldedTxHistoryStorage.getAll();
    },
    delete: async (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Promise<UnshieldedTransactionHistoryEntry | undefined> => {
      return unshieldedTxHistoryStorage.delete(hash);
    },
    serialize: async (): Promise<SerializedUnshieldedTransactionHistory> => {
      return await serializeUnshieldedTransactionHistoryStorage(unshieldedTxHistoryStorage);
    },
  };
};

const UnshieldedTransactionHistoryEntriesSchema = Schema.Array(UnshieldedTransactionHistoryEntrySchema);

export type SerializedUnshieldedTransactionHistory = string;

const serializeUnshieldedTransactionHistoryStorage = async (
  storage: TransactionHistoryStorage.TransactionHistoryStorage<UnshieldedTransactionHistoryEntry>,
): Promise<SerializedUnshieldedTransactionHistory> => {
  const entries: UnshieldedTransactionHistoryEntry[] = [];

  for await (const entry of storage.getAll()) {
    entries.push(entry);
  }

  const encoder = Schema.encodeSync(UnshieldedTransactionHistoryEntriesSchema);
  const encoded = encoder(entries);

  return JSON.stringify(encoded);
};

export const restoreUnshieldedTransactionHistoryStorage = async (
  serializedHistory: SerializedUnshieldedTransactionHistory,
  makeStorage: () => TransactionHistoryStorage.TransactionHistoryStorage<UnshieldedTransactionHistoryEntry>,
): Promise<TransactionHistoryStorage.TransactionHistoryStorage<UnshieldedTransactionHistoryEntry>> => {
  const decoder = Schema.decodeUnknownEither(UnshieldedTransactionHistoryEntriesSchema);

  const parsed = JSON.parse(serializedHistory) as unknown;
  const entries = Either.getOrElse(decoder(parsed), (error) => {
    throw new Error(`Failed to decode unshielded transaction history: ${error.message}`);
  });

  const storage = makeStorage();

  for (const entry of entries) {
    await storage.create(entry);
  }

  return storage;
};
