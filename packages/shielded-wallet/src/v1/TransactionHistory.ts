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
import { InMemoryTransactionHistoryStorage, TransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { Duration, Array as EArray, Effect, Either, Option, Schedule, Schema, Stream } from 'effect';
import { TransactionHistoryDetail } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import { HttpQueryClient } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { TransactionHistoryError } from './WalletError.js';

export const QualifiedShieldedCoinInfoSchema = Schema.Struct({
  type: Schema.String,
  nonce: Schema.String,
  value: Schema.BigInt,
  mt_index: Schema.BigInt,
});

type QualifiedShieldedCoinInfo = Schema.Schema.Type<typeof QualifiedShieldedCoinInfoSchema>;

export const ShieldedTransactionHistoryEntrySchema = Schema.Struct({
  ...TransactionHistoryStorage.TransactionHistoryCommonSchema.fields,
  receivedCoins: Schema.Array(QualifiedShieldedCoinInfoSchema),
  spentCoins: Schema.Array(QualifiedShieldedCoinInfoSchema),
});

export type ShieldedTransactionHistoryEntry = Schema.Schema.Type<typeof ShieldedTransactionHistoryEntrySchema>;

export type DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage;
  indexerClientConnection: { indexerHttpUrl: string };
};

const coinEquals = Schema.equivalence(QualifiedShieldedCoinInfoSchema);

export type TransactionMetaData = {
  hash: string;
  timestamp: number;
  status: 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS';
};

export type TransactionHistoryService = {
  create(
    changes: ledger.ZswapStateChanges,
    metadata: TransactionMetaData,
    protocolVersion: number,
  ): Effect.Effect<void, TransactionHistoryError>;
  get(
    hash: TransactionHistoryStorage.TransactionHash,
  ): Effect.Effect<Option.Option<ShieldedTransactionHistoryEntry>, TransactionHistoryError>;
  getAll(): Stream.Stream<ShieldedTransactionHistoryEntry, TransactionHistoryError>;
  delete(
    hash: TransactionHistoryStorage.TransactionHash,
  ): Effect.Effect<Option.Option<ShieldedTransactionHistoryEntry>, TransactionHistoryError>;
  serialize(): Effect.Effect<SerializedShieldedTransactionHistory, TransactionHistoryError>;
  getMetaData(
    hash: TransactionHistoryStorage.TransactionHash,
  ): Effect.Effect<TransactionMetaData, TransactionHistoryError>;
};

type ShieldedSection = {
  readonly receivedCoins: readonly QualifiedShieldedCoinInfo[];
  readonly spentCoins: readonly QualifiedShieldedCoinInfo[];
};

const hasShieldedSection = (
  entry: TransactionHistoryStorage.TransactionHistoryEntryWithHash,
): entry is StorageEntryWithShielded =>
  entry.shielded != null &&
  typeof entry.shielded === 'object' &&
  'receivedCoins' in entry.shielded &&
  'spentCoins' in entry.shielded;

const projectToShieldedEntry = (entry: StorageEntryWithShielded): ShieldedTransactionHistoryEntry => ({
  hash: entry.hash,
  protocolVersion: entry.protocolVersion,
  status: entry.status,
  identifiers: entry.identifiers ?? [],
  timestamp: entry.timestamp ?? null,
  fees: entry.fees ?? null,
  receivedCoins: entry.shielded.receivedCoins,
  spentCoins: entry.shielded.spentCoins,
});

const asShieldedEntry = (
  entry: TransactionHistoryStorage.TransactionHistoryEntryWithHash,
): Effect.Effect<ShieldedTransactionHistoryEntry, TransactionHistoryError> =>
  hasShieldedSection(entry)
    ? Effect.succeed(projectToShieldedEntry(entry))
    : Effect.fail(
        new TransactionHistoryError({ message: `No shielded data found in storage for hash: ${entry.hash}` }),
      );

const mergeShieldedSections = (existing: ShieldedSection, incoming: ShieldedSection): ShieldedSection => ({
  receivedCoins: EArray.unionWith(existing.receivedCoins, incoming.receivedCoins, coinEquals),
  spentCoins: EArray.unionWith(existing.spentCoins, incoming.spentCoins, coinEquals),
});

type StorageEntryWithShielded = TransactionHistoryStorage.TransactionHistoryEntryWithHash & {
  shielded: ShieldedSection;
};

const convertUpdateToStorageEntry = (
  changes: ledger.ZswapStateChanges,
  metadata: TransactionMetaData,
  protocolVersion: number,
): StorageEntryWithShielded => ({
  hash: changes.source,
  protocolVersion,
  status: metadata.status,
  shielded: {
    receivedCoins: changes.receivedCoins,
    spentCoins: changes.spentCoins,
  } satisfies ShieldedSection,
});

const upsertShieldedEntry = (
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage,
  entry: TransactionHistoryStorage.TransactionHistoryEntryWithHash & { shielded: ShieldedSection },
): Effect.Effect<void, TransactionHistoryError> =>
  Effect.gen(function* () {
    const existing = yield* Effect.tryPromise({
      try: () => txHistoryStorage.get(entry.hash),
      catch: (e) =>
        new TransactionHistoryError({ message: `Failed to get existing entry for ${entry.hash}`, cause: e }),
    });

    const shieldedSection =
      existing && hasShieldedSection(existing)
        ? mergeShieldedSections(existing.shielded, entry.shielded)
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
    create: (
      changes: ledger.ZswapStateChanges,
      metadata: TransactionMetaData,
      protocolVersion: number,
    ): Effect.Effect<void, TransactionHistoryError> => {
      const entry = convertUpdateToStorageEntry(changes, metadata, protocolVersion);
      return upsertShieldedEntry(txHistoryStorage, entry);
    },

    get: (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Effect.Effect<Option.Option<ShieldedTransactionHistoryEntry>, TransactionHistoryError> =>
      Effect.tryPromise({
        try: () => txHistoryStorage.get(hash),
        catch: (e) => new TransactionHistoryError({ message: `Failed to get history entry for ${hash}`, cause: e }),
      }).pipe(
        Effect.map((entry) =>
          entry && hasShieldedSection(entry) ? Option.some(projectToShieldedEntry(entry)) : Option.none(),
        ),
      ),

    getAll: (): Stream.Stream<ShieldedTransactionHistoryEntry, TransactionHistoryError> =>
      Stream.fromAsyncIterable(
        txHistoryStorage.getAll(),
        (e) => new TransactionHistoryError({ message: 'Failed to iterate history entries', cause: e }),
      ).pipe(
        Stream.filterMap((entry) =>
          hasShieldedSection(entry) ? Option.some(projectToShieldedEntry(entry)) : Option.none(),
        ),
      ),

    delete: (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Effect.Effect<Option.Option<ShieldedTransactionHistoryEntry>, TransactionHistoryError> =>
      Effect.tryPromise({
        try: () => txHistoryStorage.delete(hash),
        catch: (e) => new TransactionHistoryError({ message: `Failed to delete history entry for ${hash}`, cause: e }),
      }).pipe(
        Effect.flatMap((entry) =>
          entry ? asShieldedEntry(entry).pipe(Effect.map(Option.some)) : Effect.succeed(Option.none()),
        ),
      ),

    serialize: (): Effect.Effect<SerializedShieldedTransactionHistory, TransactionHistoryError> =>
      Stream.fromAsyncIterable(
        txHistoryStorage.getAll(),
        (e) => new TransactionHistoryError({ message: 'Failed to iterate history entries', cause: e }),
      ).pipe(
        Stream.filterMap((entry) =>
          hasShieldedSection(entry) ? Option.some(projectToShieldedEntry(entry)) : Option.none(),
        ),
        Stream.runCollect,
        Effect.map((chunk) => {
          const encoder = Schema.encodeSync(ShieldedTransactionHistoryEntriesSchema);
          return JSON.stringify(encoder(Array.from(chunk)));
        }),
      ),

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

export const makeSimulatorTransactionHistoryService = (): TransactionHistoryService => {
  const txHistoryStorage = new InMemoryTransactionHistoryStorage();

  return {
    create: (
      changes: ledger.ZswapStateChanges,
      metadata: TransactionMetaData,
      protocolVersion: number,
    ): Effect.Effect<void, TransactionHistoryError> => {
      const entry = convertUpdateToStorageEntry(changes, metadata, protocolVersion);
      return upsertShieldedEntry(txHistoryStorage, entry);
    },

    get: (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Effect.Effect<Option.Option<ShieldedTransactionHistoryEntry>, TransactionHistoryError> =>
      Effect.tryPromise({
        try: () => txHistoryStorage.get(hash),
        catch: (e) => new TransactionHistoryError({ message: `Failed to get history entry for ${hash}`, cause: e }),
      }).pipe(
        Effect.map((entry) =>
          entry && hasShieldedSection(entry) ? Option.some(projectToShieldedEntry(entry)) : Option.none(),
        ),
      ),

    getAll: (): Stream.Stream<ShieldedTransactionHistoryEntry, TransactionHistoryError> =>
      Stream.fromAsyncIterable(
        txHistoryStorage.getAll(),
        (e) => new TransactionHistoryError({ message: 'Failed to iterate history entries', cause: e }),
      ).pipe(
        Stream.filterMap((entry) =>
          hasShieldedSection(entry) ? Option.some(projectToShieldedEntry(entry)) : Option.none(),
        ),
      ),

    delete: (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Effect.Effect<Option.Option<ShieldedTransactionHistoryEntry>, TransactionHistoryError> =>
      Effect.tryPromise({
        try: () => txHistoryStorage.delete(hash),
        catch: (e) => new TransactionHistoryError({ message: `Failed to delete history entry for ${hash}`, cause: e }),
      }).pipe(
        Effect.flatMap((entry) =>
          entry ? asShieldedEntry(entry).pipe(Effect.map(Option.some)) : Effect.succeed(Option.none()),
        ),
      ),

    serialize: (): Effect.Effect<SerializedShieldedTransactionHistory, TransactionHistoryError> =>
      Stream.fromAsyncIterable(
        txHistoryStorage.getAll(),
        (e) => new TransactionHistoryError({ message: 'Failed to iterate history entries', cause: e }),
      ).pipe(
        Stream.filterMap((entry) =>
          hasShieldedSection(entry) ? Option.some(projectToShieldedEntry(entry)) : Option.none(),
        ),
        Stream.runCollect,
        Effect.map((chunk) => {
          const encoder = Schema.encodeSync(ShieldedTransactionHistoryEntriesSchema);
          return JSON.stringify(encoder(Array.from(chunk)));
        }),
      ),

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

const ShieldedTransactionHistoryEntriesSchema = Schema.Array(ShieldedTransactionHistoryEntrySchema);
export type SerializedShieldedTransactionHistory = string;

export const restoreShieldedTransactionHistoryStorage = (
  serializedHistory: SerializedShieldedTransactionHistory,
): Promise<TransactionHistoryStorage.TransactionHistoryStorage> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const txHistoryStorage = new InMemoryTransactionHistoryStorage();
      const result = Schema.decodeUnknownEither(ShieldedTransactionHistoryEntriesSchema)(
        JSON.parse(serializedHistory) as unknown,
      );

      if (Either.isLeft(result)) {
        return yield* new TransactionHistoryError({
          message: `Failed to decode shielded transaction history: ${result.left.message}`,
        });
      }

      for (const entry of result.right) {
        yield* Effect.tryPromise({
          try: () =>
            txHistoryStorage.upsert({
              hash: entry.hash,
              protocolVersion: entry.protocolVersion,
              status: entry.status,
              identifiers: entry.identifiers,
              timestamp: entry.timestamp,
              fees: entry.fees,
              shielded: {
                receivedCoins: entry.receivedCoins,
                spentCoins: entry.spentCoins,
              } satisfies ShieldedSection,
            }),
          catch: (e) =>
            new TransactionHistoryError({ message: 'Failed to restore transaction history entry', cause: e }),
        });
      }

      return txHistoryStorage;
    }),
  );
