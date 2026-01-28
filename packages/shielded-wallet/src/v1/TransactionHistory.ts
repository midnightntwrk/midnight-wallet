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
import { InMemoryTransactionHistoryStorage, TransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { Array as EArray, Effect, Schema } from 'effect';
import { TransactionHistoryDetail } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import { HttpQueryClient } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { TransactionHistoryError } from './WalletError.js';

export const QualifiedShieldedCoinInfoSchema = Schema.Struct({
  type: Schema.String,
  nonce: Schema.String,
  value: Schema.BigInt,
  mt_index: Schema.BigInt,
});

export type QualifiedShieldedCoinInfo = Schema.Schema.Type<typeof QualifiedShieldedCoinInfoSchema>;

export const ShieldedTransactionHistoryEntrySchema = Schema.Struct({
  hash: TransactionHistoryStorage.TransactionHashSchema,
  protocolVersion: Schema.Number,
  status: Schema.Literal('SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS'),
  receivedCoins: Schema.Array(QualifiedShieldedCoinInfoSchema),
  spentCoins: Schema.Array(QualifiedShieldedCoinInfoSchema),
});

export type ShieldedTransactionHistoryEntry = Schema.Schema.Type<typeof ShieldedTransactionHistoryEntrySchema>;

const coinEquals = Schema.equivalence(QualifiedShieldedCoinInfoSchema);

export const mergeShieldedEntries = (
  existing: ShieldedTransactionHistoryEntry,
  incoming: ShieldedTransactionHistoryEntry,
): ShieldedTransactionHistoryEntry => ({
  ...existing,
  ...incoming,
  receivedCoins: EArray.unionWith(existing.receivedCoins, incoming.receivedCoins, coinEquals),
  spentCoins: EArray.unionWith(existing.spentCoins, incoming.spentCoins, coinEquals),
});

export type DefaultTransactionHistoryConfiguration = {
  shieldedTxHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<ShieldedTransactionHistoryEntry>;
  indexerClientConnection: { indexerHttpUrl: string };
};

export type TransactionHistoryCapability = {
  create(changes: ledger.ZswapStateChanges, metadata: TransactionMetaData, protocolVersion: number): Promise<void>;
  get(hash: TransactionHistoryStorage.TransactionHash): Promise<ShieldedTransactionHistoryEntry | undefined>;
  getAll(): AsyncIterableIterator<ShieldedTransactionHistoryEntry>;
  delete(hash: TransactionHistoryStorage.TransactionHash): Promise<ShieldedTransactionHistoryEntry | undefined>;
};

export type TransactionMetaData = {
  hash: string;
  timestamp: number;
  status: 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS';
};

export type TransactionHistoryService = {
  getMetaData(
    hash: TransactionHistoryStorage.TransactionHash,
  ): Effect.Effect<TransactionMetaData, TransactionHistoryError>;
};

const convertUpdateToEntry = (
  changes: ledger.ZswapStateChanges,
  metadata: TransactionMetaData,
  protocolVersion: number,
): ShieldedTransactionHistoryEntry => {
  return {
    hash: changes.source,
    protocolVersion,
    status: metadata.status,
    receivedCoins: changes.receivedCoins,
    spentCoins: changes.spentCoins,
  };
};

export const makeDefaultTransactionHistoryCapability = (
  config: DefaultTransactionHistoryConfiguration,
  _getContext: () => unknown,
): TransactionHistoryCapability => {
  const { shieldedTxHistoryStorage } = config;

  return {
    create: async (
      changes: ledger.ZswapStateChanges,
      metadata: TransactionMetaData,
      protocolVersion: number,
    ): Promise<void> => {
      const entry = convertUpdateToEntry(changes, metadata, protocolVersion);
      await shieldedTxHistoryStorage.create(entry, mergeShieldedEntries);
    },
    get: async (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Promise<ShieldedTransactionHistoryEntry | undefined> => {
      return shieldedTxHistoryStorage.get(hash);
    },
    getAll: (): AsyncIterableIterator<ShieldedTransactionHistoryEntry> => {
      return shieldedTxHistoryStorage.getAll();
    },
    delete: async (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Promise<ShieldedTransactionHistoryEntry | undefined> => {
      return shieldedTxHistoryStorage.delete(hash);
    },
  };
};

export const makeDefaultTransactionHistoryService = (
  config: DefaultTransactionHistoryConfiguration,
  _getContext: () => unknown,
): TransactionHistoryService => {
  const queryClientLayer = HttpQueryClient.layer({ url: config.indexerClientConnection.indexerHttpUrl });

  return {
    getMetaData: (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Effect.Effect<TransactionMetaData, TransactionHistoryError> =>
      Effect.gen(function* () {
        const statusQuery = yield* TransactionHistoryDetail;
        const result = yield* statusQuery({ transactionHash: hash });
        const tx = result.transactions[0];
        const rawStatus = tx.__typename === 'RegularTransaction' ? tx.transactionResult.status : undefined;
        const status: TransactionMetaData['status'] =
          rawStatus === 'FAILURE' || rawStatus === 'PARTIAL_SUCCESS' ? rawStatus : 'SUCCESS';

        return {
          hash: tx.hash,
          timestamp: tx.block.timestamp,
          status,
        };
      }).pipe(
        Effect.provide(queryClientLayer),
        Effect.scoped,
        Effect.catchAll((cause) =>
          Effect.fail(
            new TransactionHistoryError({
              message: `Failed to fetch transaction metadata for ${hash}`,
              cause,
            }),
          ),
        ),
      ),
  };
};

export const makeSimulatorTransactionHistoryService = (): TransactionHistoryService => {
  return {
    getMetaData: (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Effect.Effect<TransactionMetaData, TransactionHistoryError> =>
      Effect.succeed({
        hash,
        timestamp: Date.now(),
        status: 'SUCCESS',
      }),
  };
};

export const makeSimulatorTransactionHistoryCapability = (): TransactionHistoryCapability => {
  const txHistoryStorage = new InMemoryTransactionHistoryStorage<ShieldedTransactionHistoryEntry>();

  return {
    create: async (
      changes: ledger.ZswapStateChanges,
      metadata: TransactionMetaData,
      protocolVersion: number,
    ): Promise<void> => {
      const entry = convertUpdateToEntry(changes, metadata, protocolVersion);
      await txHistoryStorage.create(entry, mergeShieldedEntries);
    },
    get: async (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Promise<ShieldedTransactionHistoryEntry | undefined> => {
      return txHistoryStorage.get(hash);
    },
    getAll: (): AsyncIterableIterator<ShieldedTransactionHistoryEntry> => {
      return txHistoryStorage.getAll();
    },
    delete: async (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Promise<ShieldedTransactionHistoryEntry | undefined> => {
      return txHistoryStorage.delete(hash);
    },
  };
};
