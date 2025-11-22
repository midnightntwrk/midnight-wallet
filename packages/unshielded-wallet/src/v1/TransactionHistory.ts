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
import { TransactionHistoryStorage, TransactionHistoryEntry, TransactionHash } from './storage/index.js';
import { UnshieldedTransaction } from '@midnight-ntwrk/wallet-sdk-unshielded-state';

export interface TransactionHistoryCapability<TTransaction> {
  create(tx: TTransaction): Promise<void>;
  get(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined>;
  getAll(): AsyncIterableIterator<TransactionHistoryEntry>;
  delete(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined>;
}

export type DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: TransactionHistoryStorage;
};

const convertTransactionToEntry = (tx: UnshieldedTransaction): TransactionHistoryEntry => {
  const isRegularTransaction = tx.type === 'RegularTransaction';
  const transactionResult =
    isRegularTransaction && tx.transactionResult
      ? {
          status: tx.transactionResult.status as 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS',
          segments:
            tx.transactionResult.segments?.map((segment) => ({
              id: segment.id.toString(),
              success: segment.success,
            })) ?? [],
        }
      : null;

  return {
    id: tx.id,
    hash: tx.hash,
    protocolVersion: tx.protocolVersion,
    identifiers: isRegularTransaction ? tx.identifiers : [],
    transactionResult,
    timestamp: tx.block?.timestamp ?? null,
    fees: isRegularTransaction ? (tx.fees?.paidFees ?? null) : null,
  };
};

export const makeDefaultTransactionHistoryCapability = <TTransaction>(
  config: DefaultTransactionHistoryConfiguration,
  _getContext: () => unknown,
): TransactionHistoryCapability<TTransaction> => {
  const { txHistoryStorage } = config;

  return {
    create: async (tx: TTransaction): Promise<void> => {
      // Cast to UnshieldedTransaction for storage - transactions in history are from sync
      const entry = convertTransactionToEntry(tx as unknown as UnshieldedTransaction);
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
