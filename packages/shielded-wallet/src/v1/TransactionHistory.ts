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
import { TransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { Duration, Array as EArray, Effect, Schedule, Schema } from 'effect';
import { TransactionHistoryDetail } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import { HttpQueryClient } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { TransactionHistoryError } from './WalletError.js';

export const QualifiedShieldedCoinInfoSchema = Schema.Struct({
  type: Schema.String,
  nonce: Schema.String,
  value: Schema.BigInt,
  mtIndex: Schema.BigInt,
});

export const ShieldedSectionSchema = Schema.Struct({
  receivedCoins: Schema.Array(QualifiedShieldedCoinInfoSchema),
  spentCoins: Schema.Array(QualifiedShieldedCoinInfoSchema),
});

type ShieldedSection = Schema.Schema.Type<typeof ShieldedSectionSchema>;

const isShieldedSection = Schema.is(ShieldedSectionSchema);

export const ShieldedTransactionHistoryEntrySchema = Schema.Struct({
  hash: TransactionHistoryStorage.TransactionHashSchema,
  protocolVersion: Schema.Number,
  status: TransactionHistoryStorage.TransactionHistoryStatusSchema,
  shielded: ShieldedSectionSchema,
});

export type ShieldedTransactionHistoryEntry = Schema.Schema.Type<typeof ShieldedTransactionHistoryEntrySchema>;

export type DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<TransactionHistoryStorage.TransactionHistoryEntryWithHash>;
  indexerClientConnection: { indexerHttpUrl: string };
};

const coinEquals = Schema.equivalence(QualifiedShieldedCoinInfoSchema);

export type TransactionDetails = {
  hash: string;
  timestamp: number;
  status: 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS';
};

export type TransactionHistoryService = {
  put(
    changes: ledger.ZswapStateChanges,
    metadata: TransactionDetails,
    protocolVersion: number,
  ): Effect.Effect<void, TransactionHistoryError>;
  getTransactionDetails(
    hash: TransactionHistoryStorage.TransactionHash,
  ): Effect.Effect<TransactionDetails, TransactionHistoryError>;
};

const mergeShieldedSections = (existing: ShieldedSection, incoming: ShieldedSection): ShieldedSection => ({
  receivedCoins: EArray.unionWith(existing.receivedCoins, incoming.receivedCoins, coinEquals),
  spentCoins: EArray.unionWith(existing.spentCoins, incoming.spentCoins, coinEquals),
});

type StorageEntryWithShielded = Omit<
  TransactionHistoryStorage.TransactionHistoryCommon,
  'identifiers' | 'timestamp' | 'fees'
> & {
  readonly shielded: ShieldedSection;
};

const convertUpdateToStorageEntry = (
  changes: ledger.ZswapStateChanges,
  metadata: TransactionDetails,
  protocolVersion: number,
): StorageEntryWithShielded => ({
  hash: changes.source,
  protocolVersion,
  status: metadata.status,
  shielded: {
    receivedCoins: changes.receivedCoins.map(({ mt_index, ...rest }) => ({ ...rest, mtIndex: mt_index })),
    spentCoins: changes.spentCoins.map(({ mt_index, ...rest }) => ({ ...rest, mtIndex: mt_index })),
  } satisfies ShieldedSection,
});

const upsertShieldedEntry = (
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<TransactionHistoryStorage.TransactionHistoryEntryWithHash>,
  entry: TransactionHistoryStorage.TransactionHistoryEntryWithHash & { shielded: ShieldedSection },
): Effect.Effect<void, TransactionHistoryError> =>
  Effect.gen(function* () {
    const existing = yield* Effect.tryPromise({
      try: () => txHistoryStorage.get(entry.hash),
      catch: (e) =>
        new TransactionHistoryError({ message: `Failed to get existing entry for ${entry.hash}`, cause: e }),
    });

    const shieldedSection =
      existing && isShieldedSection(existing['shielded'])
        ? mergeShieldedSections(existing['shielded'], entry.shielded)
        : entry.shielded;

    yield* Effect.tryPromise({
      try: () => txHistoryStorage.upsert({ ...existing, ...entry, shielded: shieldedSection }),
      catch: (e) =>
        new TransactionHistoryError({ message: `Failed to upsert history entry for ${entry.hash}`, cause: e }),
    });
  });

export const makeDefaultTransactionHistoryService = (
  config: DefaultTransactionHistoryConfiguration,
  _getContext: () => unknown,
): TransactionHistoryService => {
  const txHistoryStorage = config.txHistoryStorage;
  const queryClientLayer = HttpQueryClient.layer({ url: config.indexerClientConnection.indexerHttpUrl });

  return {
    put: (
      changes: ledger.ZswapStateChanges,
      metadata: TransactionDetails,
      protocolVersion: number,
    ): Effect.Effect<void, TransactionHistoryError> => {
      const entry = convertUpdateToStorageEntry(changes, metadata, protocolVersion);
      return upsertShieldedEntry(txHistoryStorage, entry);
    },

    getTransactionDetails: (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Effect.Effect<TransactionDetails, TransactionHistoryError> =>
      Effect.gen(function* () {
        const statusQuery = yield* TransactionHistoryDetail;
        const result = yield* statusQuery({ transactionHash: hash });
        const tx = result.transactions[0];
        const rawStatus = tx.__typename === 'RegularTransaction' ? tx.transactionResult.status : undefined;
        const status: TransactionDetails['status'] =
          rawStatus === 'FAILURE' || rawStatus === 'PARTIAL_SUCCESS' ? rawStatus : 'SUCCESS';

        return {
          hash: tx.hash,
          timestamp: tx.block.timestamp,
          status,
        };
      }).pipe(
        Effect.provide(queryClientLayer),
        Effect.scoped,
        Effect.retry(Schedule.exponential(Duration.seconds(1)).pipe(Schedule.compose(Schedule.recurs(3)))),
        Effect.mapError(
          (cause) =>
            new TransactionHistoryError({
              message: `Failed to fetch transaction metadata for ${hash}`,
              cause,
            }),
        ),
      ),
  };
};

export const makeSimulatorTransactionHistoryService = (
  config: DefaultTransactionHistoryConfiguration,
  _getContext: () => unknown,
): TransactionHistoryService => {
  const txHistoryStorage = config.txHistoryStorage;

  return {
    put: (
      changes: ledger.ZswapStateChanges,
      metadata: TransactionDetails,
      protocolVersion: number,
    ): Effect.Effect<void, TransactionHistoryError> => {
      const entry = convertUpdateToStorageEntry(changes, metadata, protocolVersion);
      return upsertShieldedEntry(txHistoryStorage, {
        ...entry,
        timestamp: new Date(metadata.timestamp),
      });
    },

    getTransactionDetails: (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Effect.Effect<TransactionDetails, TransactionHistoryError> =>
      Effect.tryPromise({
        try: () => txHistoryStorage.get(hash),
        catch: (e) =>
          new TransactionHistoryError({ message: `Failed to get transaction details for ${hash}`, cause: e }),
      }).pipe(
        Effect.flatMap((entry) =>
          entry
            ? Effect.succeed({
                hash: entry.hash,
                timestamp: entry.timestamp ? entry.timestamp.getTime() : Date.now(),
                status: entry.status,
              })
            : Effect.fail(
                new TransactionHistoryError({ message: `No transaction found in storage for hash: ${hash}` }),
              ),
        ),
      ),
  };
};
