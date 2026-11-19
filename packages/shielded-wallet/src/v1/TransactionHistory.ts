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
import { type TransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import type * as ledger from '@midnightntwrk/ledger-v8';
import { Duration, Array as EArray, Effect, Schedule, type Schema } from 'effect';
import { TransactionHistoryDetail } from '@midnightntwrk/wallet-sdk-indexer-client';
import { HttpQueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { BlocklessFinalizedEntryError, TransactionHistoryError } from './WalletError.js';

import {
  type ShieldedSectionSchema,
  type ShieldedHistoryStorage,
  type ShieldedTransactionHistoryEntry,
} from '../types/ShieldedWalletTypes.js';

export {
  QualifiedShieldedCoinInfoSchema,
  ShieldedSectionSchema,
  ShieldedTransactionHistoryEntrySchema,
  mergeShieldedSections,
  type ShieldedHistoryStorage,
  type ShieldedTransactionHistoryEntry,
} from '../types/ShieldedWalletTypes.js';

type ShieldedSection = Schema.Schema.Type<typeof ShieldedSectionSchema>;

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
  /**
   * How long one lookup keeps re-querying the indexer for a transaction's details before giving up, when the WS event
   * arrives ahead of HTTP ingestion or the indexer is briefly down. A lookup that gives up is logged and tried again
   * later; with a storage that implements `gotApplied` the entry is already stored, marked `shieldedDetailsPending`,
   * and is completed after a restart too. Default: 2 minutes.
   */
  transactionDetailsRetryWindow?: Duration.DurationInput;
};

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
  ): Effect.Effect<TransactionDetails, TransactionHistoryError | BlocklessFinalizedEntryError>;
  /**
   * Stores a change the wallet has applied as an incomplete entry — its shielded section, with `shieldedDetailsPending:
   * true` — before its details are known. Does nothing when the storage does not implement `gotApplied`. Absent from a
   * service that cannot complete such an entry later.
   */
  recordApplied?(
    changes: ledger.ZswapStateChanges,
    protocolVersion: number,
  ): Effect.Effect<void, TransactionHistoryError>;
  /** The hashes of the entries still marked `shieldedDetailsPending: true`. */
  pendingDetails?(): Effect.Effect<readonly TransactionHistoryStorage.TransactionHash[], TransactionHistoryError>;
  /** Fills in the details of an entry `recordApplied` stored, keeping its section, and clears its pending flag. */
  completeDetails?(
    hash: TransactionHistoryStorage.TransactionHash,
    metadata: TransactionDetails,
  ): Effect.Effect<void, TransactionHistoryError>;
};

const sectionOf = (changes: ledger.ZswapStateChanges): ShieldedSection => ({
  receivedCoins: changes.receivedCoins.map(({ mt_index, ...rest }) => ({ ...rest, mtIndex: mt_index })),
  spentCoins: changes.spentCoins.map(({ mt_index, ...rest }) => ({ ...rest, mtIndex: mt_index })),
});

const blockOf = (metadata: TransactionDetails): TransactionHistoryStorage.FinalizedBlock => ({
  hash: metadata.block.hash,
  height: metadata.block.height,
  timestamp: new Date(metadata.block.timestamp),
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
  finalizedBlock: blockOf(metadata),
  shielded: sectionOf(changes),
  shieldedDetailsPending: false,
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
  const retryWindow = config.transactionDetailsRetryWindow ?? Duration.minutes(2);

  return {
    put: (
      changes: ledger.ZswapStateChanges,
      metadata: TransactionDetails,
      protocolVersion: number,
    ): Effect.Effect<void, TransactionHistoryError> =>
      gotFinalizedShielded(txHistoryStorage, convertUpdateToFinalizedInput(changes, metadata, protocolVersion)),

    recordApplied: (changes: ledger.ZswapStateChanges, protocolVersion: number) =>
      Effect.tryPromise({
        try: () =>
          txHistoryStorage.gotApplied?.({
            hash: changes.source,
            identifiers: [],
            protocolVersion,
            shielded: sectionOf(changes),
            shieldedDetailsPending: true,
          }) ?? Promise.resolve(),
        catch: (e) =>
          new TransactionHistoryError({
            message: `Failed to record applied history entry for ${changes.source}`,
            cause: e,
          }),
      }),

    pendingDetails: () =>
      Effect.tryPromise({
        try: () => txHistoryStorage.getAll(),
        catch: (e) => new TransactionHistoryError({ message: 'Failed to read the transaction history', cause: e }),
      }).pipe(
        Effect.map((entries) =>
          // The reader is typed over every wallet's entries, so this wallet's flag is read by name.
          entries.filter((entry) => entry['shieldedDetailsPending'] === true).map((entry) => entry.hash),
        ),
      ),

    completeDetails: (hash: TransactionHistoryStorage.TransactionHash, metadata: TransactionDetails) =>
      Effect.tryPromise({
        try: () =>
          txHistoryStorage.gotFinalized({
            hash,
            status: metadata.status,
            identifiers: metadata.identifiers,
            finalizedBlock: blockOf(metadata),
            shieldedDetailsPending: false,
          }),
        catch: (e) =>
          new TransactionHistoryError({ message: `Failed to complete history entry for ${hash}`, cause: e }),
      }),

    getTransactionDetails: (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Effect.Effect<TransactionDetails, TransactionHistoryError> =>
      Effect.gen(function* () {
        const statusQuery = yield* TransactionHistoryDetail;
        const result = yield* statusQuery({ transactionHash: hash });
        // The WS ZswapEvents stream can deliver a relevant event before the indexer's HTTP `transactions(...)`
        // endpoint has ingested the same hash — a normal race on any deployed network. In that window the array
        // is empty; fail with a *typed* error so the retry schedule below engages and re-queries once the indexer
        // catches up (rather than dereferencing `undefined` and dying with an unretriable defect).
        const tx = yield* EArray.head(result.transactions).pipe(
          Effect.orElseFail(
            () => new TransactionHistoryError({ message: `Indexer has not yet indexed transaction ${hash}` }),
          ),
        );
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
        // Retry for a bounded window (default 2 min) while the indexer catches up. The exponential delay is capped
        // at 10s (`either` takes the earlier of the two schedules) so probes keep landing every ≤10s late in the
        // window — uncapped doubling would leave minute-long gaps and overshoot the window. Jitter the delays so a
        // batch of concurrent lookups that all hit the indexer-lag race don't retry in lockstep against an
        // already-behind indexer. Beyond the window we give up — the change is not re-processed, so the caller logs
        // the loss. Two failures are transient: the typed "not yet indexed" one, and a `ServerError` (indexer down,
        // unreachable or 5xx), which clears once the indexer is back. Anything else (bad URL, 4xx, GraphQL or schema
        // error) cannot succeed by waiting, so it fails fast instead of holding a fan-out slot for the whole window.
        Effect.retry({
          schedule: Schedule.exponential(Duration.seconds(1)).pipe(
            Schedule.either(Schedule.spaced(Duration.seconds(10))),
            Schedule.jittered,
            Schedule.upTo(retryWindow),
          ),
          while: (error) => error instanceof TransactionHistoryError || error instanceof ServerError,
        }),
        // Let our own "not yet indexed" error through untouched; only wrap the indexer query's ClientError/ServerError.
        Effect.mapError((error) =>
          error instanceof TransactionHistoryError
            ? error
            : new TransactionHistoryError({
                message: `Failed to fetch transaction metadata for ${hash}`,
                cause: error,
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
    ): Effect.Effect<TransactionDetails, TransactionHistoryError | BlocklessFinalizedEntryError> =>
      Effect.tryPromise({
        try: () => txHistoryStorage.get(hash),
        catch: (e) =>
          new TransactionHistoryError({ message: `Failed to get transaction details for ${hash}`, cause: e }),
      }).pipe(
        // Two distinct failures, reported distinctly. Storage may never have heard of the transaction; or it holds a
        // finalized entry restored from a history written before the lifecycle field existed, which records no block.
        // This service backs the simulator, where storage is the only source, so neither case can be repaired here.
        Effect.flatMap(
          (entry): Effect.Effect<TransactionDetails, TransactionHistoryError | BlocklessFinalizedEntryError> =>
            !isFinalized(entry)
              ? Effect.fail(
                  new TransactionHistoryError({ message: `No transaction found in storage for hash: ${hash}` }),
                )
              : entry.lifecycle.finalizedBlock === undefined
                ? Effect.fail(
                    new BlocklessFinalizedEntryError({
                      message: `Transaction ${hash} is finalized but its history entry records no block (restored from a pre-lifecycle history)`,
                      hash,
                    }),
                  )
                : Effect.succeed({
                    hash: entry.hash,
                    block: {
                      hash: entry.lifecycle.finalizedBlock.hash,
                      height: entry.lifecycle.finalizedBlock.height,
                      timestamp: entry.lifecycle.finalizedBlock.timestamp.getTime(),
                    },
                    status: entry.status ?? 'SUCCESS',
                    identifiers: entry.identifiers,
                  }),
        ),
      ),
  };
};
