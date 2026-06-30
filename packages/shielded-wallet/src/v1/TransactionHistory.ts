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
import { TransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { Duration, Array as EArray, Effect, Schedule, Schema } from 'effect';
import { TransactionHistoryDetail } from '@midnightntwrk/wallet-sdk-indexer-client';
import { HttpQueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
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

/**
 * Shielded entry schema. Extends the common entry shape with an optional `shielded` section. Tightening — required
 * `shielded` plus required `protocolVersion`/`status` — happens at the writer-input type, not on the stored shape.
 */
export const ShieldedTransactionHistoryEntrySchema = TransactionHistoryStorage.extendEntrySchema({
  shielded: Schema.optional(ShieldedSectionSchema),
});

export type ShieldedTransactionHistoryEntry = Schema.Schema.Type<typeof ShieldedTransactionHistoryEntrySchema>;

export type ShieldedHistoryStorage =
  TransactionHistoryStorage.TransactionHistoryReader<TransactionHistoryStorage.TransactionHistoryEntryWithHash> &
    TransactionHistoryStorage.TransactionHistoryWriter<ShieldedTransactionHistoryEntry>;

/**
 * Writer input for shielded's `gotFinalized`. The stored shape leaves fields optional, but at write time we know
 * `protocolVersion`, `status`, and the `shielded` section. Shielded does _not_ write `fees` — that's dust's concern.
 */
type ShieldedFinalizedInput = TransactionHistoryStorage.FinalizedEntryInput<ShieldedTransactionHistoryEntry> & {
  readonly protocolVersion: number;
  readonly status: TransactionHistoryStorage.TransactionHistoryStatus;
  readonly shielded: ShieldedSection;
};

export type DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: ShieldedHistoryStorage;
  indexerClientConnection: { indexerHttpUrl: string };
};

const coinEquals = Schema.equivalence(QualifiedShieldedCoinInfoSchema);

const isFinalized = (
  entry: TransactionHistoryStorage.TransactionHistoryEntryCommon | undefined,
): entry is TransactionHistoryStorage.FinalizedTransactionHistoryCommon =>
  entry !== undefined && entry.lifecycle.status === 'finalized';

export type TransactionDetails = {
  hash: string;
  block: {
    hash: string;
    height: number;
    timestamp: number;
  };
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
): ShieldedFinalizedInput => ({
  hash: changes.source,
  protocolVersion,
  status: metadata.status,
  identifiers: metadata.identifiers,
  finalizedBlock: {
    hash: metadata.block.hash,
    height: metadata.block.height,
    timestamp: new Date(metadata.block.timestamp),
  },
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
      gotFinalizedShielded(txHistoryStorage, convertUpdateToFinalizedInput(changes, metadata, protocolVersion)),

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
          block: {
            hash: tx.block.hash,
            height: tx.block.height,
            timestamp: tx.block.timestamp,
          },
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
      const input = convertUpdateToFinalizedInput(changes, metadata, protocolVersion);
      return gotFinalizedShielded(txHistoryStorage, { ...input, timestamp: input.finalizedBlock.timestamp });
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
                block: {
                  hash: entry.lifecycle.finalizedBlock.hash,
                  height: entry.lifecycle.finalizedBlock.height,
                  timestamp: entry.lifecycle.finalizedBlock.timestamp.getTime(),
                },
                status: entry.status ?? 'SUCCESS',
                identifiers: entry.identifiers,
              })
            : Effect.fail(
                new TransactionHistoryError({ message: `No transaction found in storage for hash: ${hash}` }),
              ),
        ),
      ),
  };
};
