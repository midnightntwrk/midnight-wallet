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

export const DustUtxoInfoSchema = Schema.Struct({
  initialValue: Schema.BigInt,
  nonce: Schema.BigInt,
  seq: Schema.Number,
  backingNight: Schema.String,
  mtIndex: Schema.BigInt,
});

export const DustSectionSchema = Schema.Struct({
  receivedUtxos: Schema.Array(DustUtxoInfoSchema),
  spentUtxos: Schema.Array(DustUtxoInfoSchema),
});

type DustSection = Schema.Schema.Type<typeof DustSectionSchema>;

export const DustTransactionHistoryEntrySchema = Schema.Struct({
  hash: TransactionHistoryStorage.TransactionHashSchema,
  protocolVersion: Schema.Number,
  status: TransactionHistoryStorage.TransactionHistoryStatusSchema,
  identifiers: Schema.optional(Schema.Array(Schema.String)),
  dust: DustSectionSchema,
});

export type DustTransactionHistoryEntry = Schema.Schema.Type<typeof DustTransactionHistoryEntrySchema>;

export type DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<TransactionHistoryStorage.TransactionHistoryEntryWithHash>;
  indexerClientConnection: { indexerHttpUrl: string };
};

const utxoEquals = Schema.equivalence(DustUtxoInfoSchema);

export type TransactionDetails = {
  hash: string;
  timestamp: number;
  status: 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS';
  identifiers: readonly string[];
};

export type TransactionHistoryService = {
  put(
    changes: ledger.DustStateChanges,
    metadata: TransactionDetails,
    protocolVersion: number,
  ): Effect.Effect<void, TransactionHistoryError>;
  getTransactionDetails(
    hash: TransactionHistoryStorage.TransactionHash,
  ): Effect.Effect<TransactionDetails, TransactionHistoryError>;
};

export const mergeDustSections = (existing: DustSection, incoming: DustSection): DustSection => ({
  receivedUtxos: EArray.unionWith(existing.receivedUtxos, incoming.receivedUtxos, utxoEquals),
  spentUtxos: EArray.unionWith(existing.spentUtxos, incoming.spentUtxos, utxoEquals),
});

type StorageEntryWithDust = Omit<TransactionHistoryStorage.TransactionHistoryCommon, 'timestamp' | 'fees'> & {
  readonly dust: DustSection;
};

const convertQualifiedDustOutput = (utxo: ledger.QualifiedDustOutput) => ({
  initialValue: utxo.initialValue,
  nonce: utxo.nonce,
  seq: utxo.seq,
  backingNight: utxo.backingNight,
  mtIndex: utxo.mtIndex,
});

const convertUpdateToStorageEntry = (
  changes: ledger.DustStateChanges,
  metadata: TransactionDetails,
  protocolVersion: number,
): StorageEntryWithDust => ({
  hash: changes.source,
  protocolVersion,
  status: metadata.status,
  identifiers: metadata.identifiers,
  dust: {
    receivedUtxos: changes.receivedUtxos.map(convertQualifiedDustOutput),
    spentUtxos: changes.spentUtxos.map(convertQualifiedDustOutput),
  } satisfies DustSection,
});

const upsertDustEntry = (
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<TransactionHistoryStorage.TransactionHistoryEntryWithHash>,
  entry: TransactionHistoryStorage.TransactionHistoryEntryWithHash & { dust: DustSection },
): Effect.Effect<void, TransactionHistoryError> =>
  Effect.tryPromise({
    try: () => txHistoryStorage.upsert(entry),
    catch: (e) =>
      new TransactionHistoryError({ message: `Failed to upsert history entry for ${entry.hash}`, cause: e }),
  });

const clearPendingForIdentifiers = (
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<TransactionHistoryStorage.TransactionHistoryEntryWithHash>,
  identifiers: readonly string[],
): Effect.Effect<void, TransactionHistoryError> =>
  Effect.tryPromise({
    // TODO Ian — temp, remove the `'dust-sync'` label (helper takes optional source for logging)
    try: () => TransactionHistoryStorage.clearPendingMatching(txHistoryStorage, identifiers, 'dust-sync'),
    // TODO Ian — end temp, remove
    catch: (e) => new TransactionHistoryError({ message: 'Failed to clear pending entry on confirmation', cause: e }),
  });

export const makeDefaultTransactionHistoryService = (
  config: DefaultTransactionHistoryConfiguration,
  _getContext: () => unknown,
): TransactionHistoryService => {
  const txHistoryStorage = config.txHistoryStorage;
  const queryClientLayer = HttpQueryClient.layer({ url: config.indexerClientConnection.indexerHttpUrl });

  return {
    put: (
      changes: ledger.DustStateChanges,
      metadata: TransactionDetails,
      protocolVersion: number,
    ): Effect.Effect<void, TransactionHistoryError> => {
      const entry = convertUpdateToStorageEntry(changes, metadata, protocolVersion);
      return Effect.gen(function* () {
        yield* upsertDustEntry(txHistoryStorage, entry);
        yield* clearPendingForIdentifiers(txHistoryStorage, metadata.identifiers);
      });
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
      changes: ledger.DustStateChanges,
      metadata: TransactionDetails,
      protocolVersion: number,
    ): Effect.Effect<void, TransactionHistoryError> => {
      const entry = convertUpdateToStorageEntry(changes, metadata, protocolVersion);
      return Effect.gen(function* () {
        yield* upsertDustEntry(txHistoryStorage, { ...entry, timestamp: new Date(metadata.timestamp) });
        yield* clearPendingForIdentifiers(txHistoryStorage, metadata.identifiers);
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
                identifiers: entry.identifiers ?? [],
              })
            : Effect.fail(
                new TransactionHistoryError({ message: `No transaction found in storage for hash: ${hash}` }),
              ),
        ),
      ),
  };
};
