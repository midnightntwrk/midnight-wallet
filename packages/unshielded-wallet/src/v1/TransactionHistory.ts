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
import { Effect, Either, Option, Schema, Stream } from 'effect';
import { UnshieldedUpdate } from './SyncSchema.js';
import { SafeBigInt } from '@midnight-ntwrk/wallet-sdk-utilities';
import { TransactionHistoryError } from './WalletError.js';

const UtxoSchema = Schema.Struct({
  value: SafeBigInt.SafeBigInt,
  owner: Schema.String,
  tokenType: Schema.String,
  intentHash: Schema.String,
  outputIndex: Schema.Number,
});

type Utxo = Schema.Schema.Type<typeof UtxoSchema>;

export const UnshieldedTransactionHistoryEntrySchema = Schema.Struct({
  ...TransactionHistoryStorage.TransactionHistoryCommonSchema.fields,
  id: Schema.Number,
  createdUtxos: Schema.Array(UtxoSchema),
  spentUtxos: Schema.Array(UtxoSchema),
});

export type UnshieldedTransactionHistoryEntry = Schema.Schema.Type<typeof UnshieldedTransactionHistoryEntrySchema>;

export type TransactionHistoryService = {
  put(update: UnshieldedUpdate): Effect.Effect<void, TransactionHistoryError>;
  get(
    hash: TransactionHistoryStorage.TransactionHash,
  ): Effect.Effect<Option.Option<UnshieldedTransactionHistoryEntry>, TransactionHistoryError>;
  getAll(): Stream.Stream<UnshieldedTransactionHistoryEntry, TransactionHistoryError>;
  delete(
    hash: TransactionHistoryStorage.TransactionHash,
  ): Effect.Effect<Option.Option<UnshieldedTransactionHistoryEntry>, TransactionHistoryError>;
  serialize(): Effect.Effect<SerializedUnshieldedTransactionHistory, TransactionHistoryError>;
};

export type DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage;
};

type UnshieldedSection = {
  readonly id: number;
  readonly createdUtxos: readonly Utxo[];
  readonly spentUtxos: readonly Utxo[];
};

type StorageEntryWithUnshielded = Omit<
  TransactionHistoryStorage.TransactionHistoryEntryWithHash,
  'identifiers' | 'timestamp' | 'fees'
> & {
  readonly identifiers: readonly string[];
  readonly timestamp: Date;
  readonly fees: bigint | null;
  readonly unshielded: UnshieldedSection;
};

const hasUnshieldedSection = (
  entry: TransactionHistoryStorage.TransactionHistoryEntryWithHash,
): entry is StorageEntryWithUnshielded =>
  entry.unshielded != null &&
  typeof entry.unshielded === 'object' &&
  'id' in entry.unshielded &&
  'createdUtxos' in entry.unshielded &&
  'spentUtxos' in entry.unshielded;

const projectToUnshieldedEntry = (entry: StorageEntryWithUnshielded): UnshieldedTransactionHistoryEntry => {
  const { id, createdUtxos, spentUtxos } = entry.unshielded;
  return {
    id,
    hash: entry.hash,
    protocolVersion: entry.protocolVersion,
    identifiers: entry.identifiers,
    timestamp: entry.timestamp,
    fees: entry.fees as UnshieldedTransactionHistoryEntry['fees'],
    status: entry.status,
    createdUtxos,
    spentUtxos,
  };
};

const asUnshieldedEntry = (
  entry: TransactionHistoryStorage.TransactionHistoryEntryWithHash,
): Effect.Effect<UnshieldedTransactionHistoryEntry, TransactionHistoryError> =>
  hasUnshieldedSection(entry)
    ? Effect.succeed(projectToUnshieldedEntry(entry))
    : Effect.fail(
        new TransactionHistoryError({
          message: `No unshielded data found in storage for hash: ${entry.hash}`,
        }),
      );

const convertUpdateToStorageEntry = ({
  transaction,
  createdUtxos,
  spentUtxos,
  status,
}: UnshieldedUpdate): StorageEntryWithUnshielded => ({
  hash: transaction.hash,
  protocolVersion: transaction.protocolVersion,
  status,
  identifiers: transaction.identifiers ?? [],
  timestamp: transaction.block.timestamp,
  fees: transaction.fees?.paidFees ?? null,
  unshielded: {
    id: transaction.id,
    createdUtxos: createdUtxos.map(({ utxo }) => ({
      value: utxo.value,
      owner: utxo.owner,
      tokenType: utxo.type,
      intentHash: utxo.intentHash,
      outputIndex: utxo.outputNo,
    })),
    spentUtxos: spentUtxos.map(({ utxo }) => ({
      value: utxo.value,
      owner: utxo.owner,
      tokenType: utxo.type,
      intentHash: utxo.intentHash,
      outputIndex: utxo.outputNo,
    })),
  },
});

export const makeDefaultTransactionHistoryService = (
  config: DefaultTransactionHistoryConfiguration,
  _getContext: () => unknown,
): TransactionHistoryService => {
  const txHistoryStorage = config.txHistoryStorage;

  return {
    put: (update: UnshieldedUpdate): Effect.Effect<void, TransactionHistoryError> =>
      Effect.tryPromise({
        try: () => txHistoryStorage.upsert(convertUpdateToStorageEntry(update)),
        catch: (e) => new TransactionHistoryError({ message: 'Failed to put transaction history entry', cause: e }),
      }),

    get: (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Effect.Effect<Option.Option<UnshieldedTransactionHistoryEntry>, TransactionHistoryError> =>
      Effect.tryPromise({
        try: () => txHistoryStorage.get(hash),
        catch: (e) => new TransactionHistoryError({ message: 'Failed to get transaction history entry', cause: e }),
      }).pipe(
        Effect.map((entry) =>
          entry && hasUnshieldedSection(entry) ? Option.some(projectToUnshieldedEntry(entry)) : Option.none(),
        ),
      ),

    getAll: (): Stream.Stream<UnshieldedTransactionHistoryEntry, TransactionHistoryError> =>
      Stream.fromAsyncIterable(
        txHistoryStorage.getAll(),
        (e) => new TransactionHistoryError({ message: 'Failed to iterate transaction history', cause: e }),
      ).pipe(
        Stream.filterMap((entry) =>
          hasUnshieldedSection(entry) ? Option.some(projectToUnshieldedEntry(entry)) : Option.none(),
        ),
      ),

    delete: (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Effect.Effect<Option.Option<UnshieldedTransactionHistoryEntry>, TransactionHistoryError> =>
      Effect.tryPromise({
        try: () => txHistoryStorage.delete(hash),
        catch: (e) => new TransactionHistoryError({ message: 'Failed to delete transaction history entry', cause: e }),
      }).pipe(
        Effect.flatMap((entry) =>
          entry ? asUnshieldedEntry(entry).pipe(Effect.map(Option.some)) : Effect.succeed(Option.none()),
        ),
      ),

    serialize: (): Effect.Effect<SerializedUnshieldedTransactionHistory, TransactionHistoryError> =>
      Stream.fromAsyncIterable(
        txHistoryStorage.getAll(),
        (e) => new TransactionHistoryError({ message: 'Failed to iterate transaction history', cause: e }),
      ).pipe(
        Stream.filterMap((entry) =>
          hasUnshieldedSection(entry) ? Option.some(projectToUnshieldedEntry(entry)) : Option.none(),
        ),
        Stream.runCollect,
        Effect.map((entries) => {
          const encoder = Schema.encodeSync(UnshieldedTransactionHistoryEntriesSchema);
          return JSON.stringify(encoder(Array.from(entries)));
        }),
      ),
  };
};

const UnshieldedTransactionHistoryEntriesSchema = Schema.Array(UnshieldedTransactionHistoryEntrySchema);
export type SerializedUnshieldedTransactionHistory = string;

export const restoreUnshieldedTransactionHistoryStorage = (
  serializedHistory: SerializedUnshieldedTransactionHistory,
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage,
): Promise<TransactionHistoryStorage.TransactionHistoryStorage> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = Schema.decodeUnknownEither(UnshieldedTransactionHistoryEntriesSchema)(
        JSON.parse(serializedHistory) as unknown,
      );

      if (Either.isLeft(result)) {
        return yield* new TransactionHistoryError({
          message: `Failed to decode unshielded transaction history: ${result.left.message}`,
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
              unshielded: {
                id: entry.id,
                createdUtxos: entry.createdUtxos,
                spentUtxos: entry.spentUtxos,
              },
            }),
          catch: (e) =>
            new TransactionHistoryError({ message: 'Failed to restore transaction history entry', cause: e }),
        });
      }

      return txHistoryStorage;
    }),
  );
