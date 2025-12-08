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
import { TransactionHistoryStorage, TransactionHistoryEntry, TransactionHash } from '../storage/index.js';
import { UnshieldedUpdate } from './SyncSchema.js';

export interface TransactionHistoryService<SyncUpdate> {
  create(update: SyncUpdate): Promise<void>;
  get(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined>;
  getAll(): AsyncIterableIterator<TransactionHistoryEntry>;
  delete(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined>;
}

export type DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: TransactionHistoryStorage;
};

const convertUpdateToEntry = ({ transaction, status }: UnshieldedUpdate): TransactionHistoryEntry => {
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
  const { txHistoryStorage } = config;

  return {
    create: async (update: UnshieldedUpdate): Promise<void> => {
      const entry = convertUpdateToEntry(update);
      await txHistoryStorage.create(entry);
    },
    get: async (hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> => {
      return await txHistoryStorage.get(hash);
    },
    getAll: (): AsyncIterableIterator<TransactionHistoryEntry> => {
      return txHistoryStorage.getAll();
    },
    delete: async (hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> => {
      return txHistoryStorage.delete(hash);
    },
  };
};
