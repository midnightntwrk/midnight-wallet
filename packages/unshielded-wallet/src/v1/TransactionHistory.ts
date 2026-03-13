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

export const UnshieldedTransactionHistoryEntrySchema = Schema.Struct({
  id: Schema.Number,
  hash: TransactionHistoryStorage.TransactionHashSchema,
  protocolVersion: Schema.Number,
  identifiers: Schema.Array(Schema.String),
  timestamp: Schema.Date,
  fees: Schema.NullOr(SafeBigInt.SafeBigInt),
  status: Schema.Literal('SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS'),
  createdUtxos: Schema.Array(UtxoSchema),
  spentUtxos: Schema.Array(UtxoSchema),
});

export type UnshieldedTransactionHistoryEntry = Schema.Schema.Type<typeof UnshieldedTransactionHistoryEntrySchema>;

export type TransactionHistoryService = {
  create(update: UnshieldedUpdate): Effect.Effect<void, TransactionHistoryError>;
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

const isUnshieldedEntry = Schema.is(UnshieldedTransactionHistoryEntrySchema);

const asUnshieldedEntry = (
  entry: TransactionHistoryStorage.TransactionHistoryEntryWithHash,
): Effect.Effect<UnshieldedTransactionHistoryEntry, TransactionHistoryError> =>
  isUnshieldedEntry(entry)
    ? Effect.succeed(entry)
    : Effect.fail(
        new TransactionHistoryError({
          message: `Corrupted history entry found in storage for hash: ${entry.hash}`,
        }),
      );

const convertUpdateToEntry = ({
  transaction,
  createdUtxos,
  spentUtxos,
  status,
}: UnshieldedUpdate): UnshieldedTransactionHistoryEntry => {
  return {
    id: transaction.id,
    hash: transaction.hash,
    protocolVersion: transaction.protocolVersion,
    identifiers: transaction.identifiers ? transaction.identifiers : [],
    status,
    timestamp: transaction.block?.timestamp ?? null,
    fees: transaction.fees?.paidFees ?? null,
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
  };
};

export const makeDefaultTransactionHistoryService = (
  config: DefaultTransactionHistoryConfiguration,
  _getContext: () => unknown,
): TransactionHistoryService => {
  const txHistoryStorage = new TransactionHistoryStorage.NamespacedTransactionHistoryStorage(
    'unshielded',
    config.txHistoryStorage,
  );

  return {
    create: (update: UnshieldedUpdate): Effect.Effect<void, TransactionHistoryError> =>
      Effect.tryPromise({
        try: () => txHistoryStorage.create(convertUpdateToEntry(update)),
        catch: (e) => new TransactionHistoryError({ message: 'Failed to create transaction history entry', cause: e }),
      }),

    get: (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Effect.Effect<Option.Option<UnshieldedTransactionHistoryEntry>, TransactionHistoryError> =>
      Effect.tryPromise({
        try: () => txHistoryStorage.get(hash),
        catch: (e) => new TransactionHistoryError({ message: 'Failed to get transaction history entry', cause: e }),
      }).pipe(
        Effect.flatMap((entry) =>
          entry ? asUnshieldedEntry(entry).pipe(Effect.map(Option.some)) : Effect.succeed(Option.none()),
        ),
      ),

    getAll: (): Stream.Stream<UnshieldedTransactionHistoryEntry, TransactionHistoryError> =>
      Stream.fromAsyncIterable(
        txHistoryStorage.getAll(),
        (e) => new TransactionHistoryError({ message: 'Failed to iterate transaction history', cause: e }),
      ).pipe(Stream.flatMap((entry) => Stream.fromEffect(asUnshieldedEntry(entry)))),

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
        Stream.flatMap((entry) => Stream.fromEffect(asUnshieldedEntry(entry))),
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
): Promise<TransactionHistoryStorage.TransactionHistoryStorage> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const txHistoryStorage = new InMemoryTransactionHistoryStorage();
      const namespacedStorage = new TransactionHistoryStorage.NamespacedTransactionHistoryStorage(
        'unshielded',
        txHistoryStorage,
      );
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
          try: () => namespacedStorage.create(entry),
          catch: (e) =>
            new TransactionHistoryError({ message: 'Failed to restore transaction history entry', cause: e }),
        });
      }

      return txHistoryStorage;
    }),
  );
