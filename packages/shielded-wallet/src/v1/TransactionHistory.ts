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

export const ShieldedTransactionHistoryEntrySchema = Schema.Struct({
  hash: TransactionHistoryStorage.TransactionHashSchema,
  protocolVersion: Schema.Number,
  status: TransactionHistoryStorage.TransactionHistoryStatusSchema,
  identifiers: Schema.optional(Schema.Array(Schema.String)),
  lifecycle: TransactionHistoryStorage.FinalizedLifecycleSchema,
  shielded: ShieldedSectionSchema,
});

export type ShieldedTransactionHistoryEntry = Schema.Schema.Type<typeof ShieldedTransactionHistoryEntrySchema>;

type StorageEntryWithShielded = TransactionHistoryStorage.FinalizedTransactionHistoryCommon & {
  readonly shielded: ShieldedSection;
};

export type ShieldedHistoryStorage =
  TransactionHistoryStorage.TransactionHistoryReader<TransactionHistoryStorage.TransactionHistoryEntryWithHash> &
    TransactionHistoryStorage.TransactionHistoryWriter<StorageEntryWithShielded>;

type ShieldedFinalizedInput = TransactionHistoryStorage.FinalizedEntryInput<StorageEntryWithShielded>;

export type DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: ShieldedHistoryStorage;
  indexerClientConnection: { indexerHttpUrl: string };
};

const coinEquals = Schema.equivalence(QualifiedShieldedCoinInfoSchema);

const isFinalized: (u: unknown) => u is TransactionHistoryStorage.FinalizedTransactionHistoryCommon = Schema.is(
  TransactionHistoryStorage.FinalizedTransactionHistoryCommonSchema,
);

export type TransactionDetails = {
  hash: string;
  timestamp: number;
  status: 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS';
  identifiers: readonly string[];
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

export const mergeShieldedSections = (existing: ShieldedSection, incoming: ShieldedSection): ShieldedSection => ({
  receivedCoins: EArray.unionWith(existing.receivedCoins, incoming.receivedCoins, coinEquals),
  spentCoins: EArray.unionWith(existing.spentCoins, incoming.spentCoins, coinEquals),
});

const convertUpdateToFinalizedInput = (
  changes: ledger.ZswapStateChanges,
  metadata: TransactionDetails,
  protocolVersion: number,
  finalizedAt: Date,
): ShieldedFinalizedInput => ({
  hash: changes.source,
  protocolVersion,
  status: metadata.status,
  identifiers: metadata.identifiers,
  finalizedAt,
  shielded: {
    receivedCoins: changes.receivedCoins.map(({ mt_index, ...rest }) => ({ ...rest, mtIndex: mt_index })),
    spentCoins: changes.spentCoins.map(({ mt_index, ...rest }) => ({ ...rest, mtIndex: mt_index })),
  } satisfies ShieldedSection,
});

const gotFinalizedShielded = (
  txHistoryStorage: ShieldedHistoryStorage,
  input: ShieldedFinalizedInput,
): Effect.Effect<void, TransactionHistoryError> =>
  Effect.tryPromise({
    try: () => txHistoryStorage.gotFinalized(input),
    catch: (e) =>
      new TransactionHistoryError({ message: `Failed to record finalized history entry for ${input.hash}`, cause: e }),
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
    ): Effect.Effect<void, TransactionHistoryError> =>
      gotFinalizedShielded(
        txHistoryStorage,
        convertUpdateToFinalizedInput(changes, metadata, protocolVersion, new Date(metadata.timestamp)),
      ),

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
        const identifiers = tx.__typename === 'RegularTransaction' ? tx.identifiers : [];

        return {
          hash: tx.hash,
          timestamp: tx.block.timestamp,
          status,
          identifiers,
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
      const finalizedAt = new Date(metadata.timestamp);
      const input = convertUpdateToFinalizedInput(changes, metadata, protocolVersion, finalizedAt);
      return gotFinalizedShielded(txHistoryStorage, { ...input, timestamp: finalizedAt });
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
          isFinalized(entry)
            ? Effect.succeed({
                hash: entry.hash,
                timestamp: entry.timestamp ? entry.timestamp.getTime() : Date.now(),
                status: entry.status,
                identifiers: entry.identifiers ?? [],
              })
            : Effect.fail(
                new TransactionHistoryError({ message: `No transaction found in storage for hash: ${hash}` }),
              ),
        ),
      ),
  };
};
