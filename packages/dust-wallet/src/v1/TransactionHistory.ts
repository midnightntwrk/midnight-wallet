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

/**
 * Dust entry schema. Extends the common entry shape with an optional `dust` section. Tightening — required `dust` plus
 * required `protocolVersion`/`status`/`fees` — happens at the writer-input type, not on the stored shape.
 */
export const DustTransactionHistoryEntrySchema = TransactionHistoryStorage.extendEntrySchema({
  dust: Schema.optional(DustSectionSchema),
});

export type DustTransactionHistoryEntry = Schema.Schema.Type<typeof DustTransactionHistoryEntrySchema>;

export type DustHistoryStorage =
  TransactionHistoryStorage.TransactionHistoryReader<TransactionHistoryStorage.TransactionHistoryEntryWithHash> &
    TransactionHistoryStorage.TransactionHistoryWriter<DustTransactionHistoryEntry>;

/**
 * Writer input for dust's `gotFinalized`. The stored shape leaves most fields optional, but at write time we know
 * everything: `protocolVersion`, `status`, `fees`, and the `dust` section are required. (Dust is the canonical source
 * for `fees` since fees are paid in dust.)
 */
type DustFinalizedInput = TransactionHistoryStorage.FinalizedEntryInput<DustTransactionHistoryEntry> & {
  readonly protocolVersion: number;
  readonly status: TransactionHistoryStorage.TransactionHistoryStatus;
  readonly fees: bigint | null;
  readonly dust: DustSection;
};

export type DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: DustHistoryStorage;
  indexerClientConnection: { indexerHttpUrl: string };
};

const utxoEquals = Schema.equivalence(DustUtxoInfoSchema);

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
  fees: bigint | null;
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

const convertQualifiedDustOutput = (utxo: ledger.QualifiedDustOutput) => ({
  initialValue: utxo.initialValue,
  nonce: utxo.nonce,
  seq: utxo.seq,
  backingNight: utxo.backingNight,
  mtIndex: utxo.mtIndex,
});

const convertUpdateToFinalizedInput = (
  changes: ledger.DustStateChanges,
  metadata: TransactionDetails,
  protocolVersion: number,
): DustFinalizedInput => ({
  hash: changes.source,
  protocolVersion,
  status: metadata.status,
  identifiers: metadata.identifiers,
  fees: metadata.fees,
  finalizedBlock: {
    hash: metadata.block.hash,
    height: metadata.block.height,
    timestamp: new Date(metadata.block.timestamp),
  },
  dust: {
    receivedUtxos: changes.receivedUtxos.map(convertQualifiedDustOutput),
    spentUtxos: changes.spentUtxos.map(convertQualifiedDustOutput),
  } satisfies DustSection,
});

const gotFinalizedDust = (
  txHistoryStorage: DustHistoryStorage,
  input: DustFinalizedInput,
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
      changes: ledger.DustStateChanges,
      metadata: TransactionDetails,
      protocolVersion: number,
    ): Effect.Effect<void, TransactionHistoryError> =>
      gotFinalizedDust(txHistoryStorage, convertUpdateToFinalizedInput(changes, metadata, protocolVersion)),

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
        const fees: bigint | null = tx.__typename === 'RegularTransaction' ? BigInt(tx.fees.paidFees) : null;

        return {
          hash: tx.hash,
          block: {
            hash: tx.block.hash,
            height: tx.block.height,
            timestamp: tx.block.timestamp,
          },
          status,
          identifiers,
          fees,
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
      const input = convertUpdateToFinalizedInput(changes, metadata, protocolVersion);
      return gotFinalizedDust(txHistoryStorage, { ...input, timestamp: input.finalizedBlock.timestamp });
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
                fees: entry.fees ?? null,
              })
            : Effect.fail(
                new TransactionHistoryError({ message: `No transaction found in storage for hash: ${hash}` }),
              ),
        ),
      ),
  };
};
