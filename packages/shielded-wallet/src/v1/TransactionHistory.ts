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
import { Duration, Array as EArray, Effect, Match, Option, Schedule, Schema } from 'effect';
import { TransactionHistoryDetail } from '@midnightntwrk/wallet-sdk-indexer-client';
import { HttpQueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
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

/**
 * Writer input for shielded's `gotApplied`: an entry stored before its details are known. It always carries the
 * shielded section and `shieldedDetailsPending: true`, so the wallet can tell it from a finished entry and complete
 * it.
 */
type ShieldedAppliedInput = TransactionHistoryStorage.AppliedEntryInput<ShieldedTransactionHistoryEntry> & {
  readonly protocolVersion: number;
  readonly shielded: ShieldedSection;
  readonly shieldedDetailsPending: true;
};

export type DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: ShieldedHistoryStorage;
  indexerClientConnection: { indexerHttpUrl: string };
  /**
   * How long one lookup keeps re-querying the indexer for a transaction's details before giving up, when the WS event
   * arrives ahead of HTTP ingestion or the indexer is briefly down. A lookup that gives up is logged and tried again
   * later; with a storage that implements `gotApplied` the entry is already stored, marked `shieldedDetailsPending`,
   * and is completed after a restart too. A lookup that waiting cannot fix (an invalid indexer URL, a 4xx response or a
   * GraphQL error) is not retried at all, within the window or later. Default: 2 minutes.
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

/**
 * Entries stored as soon as the wallet applies a change, before the indexer has told it the change's details, and
 * completed once it has. A snapshot taken at any moment is then never ahead of its history: the entry is already there,
 * marked `shieldedDetailsPending: true`, and a wallet restored from that snapshot completes it.
 *
 * @example
 *   ```ts
 *   const appliedEntries = service.appliedEntries;
 *   if (appliedEntries !== undefined) {
 *     yield* appliedEntries.record(changes, protocolVersion);
 *     const hashes = yield* appliedEntries.pending();
 *     yield* Effect.forEach(hashes, (hash) =>
 *       service.getTransactionDetails(hash).pipe(Effect.flatMap((details) => appliedEntries.complete(hash, details))),
 *     );
 *   }
 *   ```;
 */
export type AppliedEntries = {
  /**
   * Stores a change the wallet has applied as an incomplete entry: its shielded section, with `shieldedDetailsPending:
   * true`, and no block, status or identifiers yet.
   *
   * @example
   *   ```ts
   *   yield* appliedEntries.record(changes, protocolVersion);
   *   ```;
   *
   * @param changes The change the wallet applied; its `source` is the transaction hash.
   * @param protocolVersion The protocol version the change was applied under.
   * @returns An effect that succeeds once the entry is stored.
   */
  record(changes: ledger.ZswapStateChanges, protocolVersion: number): Effect.Effect<void, TransactionHistoryError>;
  /**
   * Reads which entries are still marked `shieldedDetailsPending: true`.
   *
   * @example
   *   ```ts
   *   const hashes = yield* appliedEntries.pending();
   *   ```;
   *
   * @returns An effect with the hashes of those entries.
   */
  pending(): Effect.Effect<readonly TransactionHistoryStorage.TransactionHash[], TransactionHistoryError>;
  /**
   * Fills in the details of an entry `record` stored, keeping its section, and clears its pending flag.
   *
   * @example
   *   ```ts
   *   yield* appliedEntries.complete(hash, yield* service.getTransactionDetails(hash));
   *   ```;
   *
   * @param hash The transaction whose entry to complete.
   * @param metadata Its details, as `getTransactionDetails` returned them.
   * @returns An effect that succeeds once the entry is completed.
   */
  complete(
    hash: TransactionHistoryStorage.TransactionHash,
    metadata: TransactionDetails,
  ): Effect.Effect<void, TransactionHistoryError>;
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
   * Present only when the storage implements `gotApplied`, the one way an entry can be stored before its details are
   * known; absent, the wallet writes each entry once its details are known.
   */
  readonly appliedEntries?: AppliedEntries;
};

const convertCoin = <C extends { readonly mt_index: bigint }>({ mt_index, ...rest }: C) => ({
  ...rest,
  mtIndex: mt_index,
});

const sectionOf = (changes: ledger.ZswapStateChanges): ShieldedSection => ({
  receivedCoins: changes.receivedCoins.map(convertCoin),
  spentCoins: changes.spentCoins.map(convertCoin),
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

/** Whether a history entry, typed over every wallet's entries, is marked `shieldedDetailsPending: true`. */
const isShieldedDetailsPending = Option.liftPredicate(
  Schema.is(Schema.Struct({ shieldedDetailsPending: Schema.Literal(true) })),
);

const appliedEntriesOf = (
  txHistoryStorage: ShieldedHistoryStorage,
  gotApplied: (entry: ShieldedAppliedInput) => Promise<void>,
): AppliedEntries => ({
  record: (changes, protocolVersion) =>
    Effect.tryPromise({
      try: () =>
        gotApplied({
          hash: changes.source,
          identifiers: [],
          protocolVersion,
          shielded: sectionOf(changes),
          shieldedDetailsPending: true,
        }),
      catch: (e) =>
        new TransactionHistoryError({
          message: `Failed to record applied history entry for ${changes.source}`,
          cause: e,
        }),
    }),

  pending: () =>
    Effect.tryPromise({
      try: () => txHistoryStorage.getAll(),
      catch: (e) => new TransactionHistoryError({ message: 'Failed to read the transaction history', cause: e }),
    }).pipe(
      Effect.map((entries) =>
        entries.filter((entry) => Option.isSome(isShieldedDetailsPending(entry))).map((entry) => entry.hash),
      ),
    ),

  complete: (hash, metadata) =>
    Effect.tryPromise({
      try: () =>
        txHistoryStorage.gotFinalized({
          hash,
          status: metadata.status,
          identifiers: metadata.identifiers,
          finalizedBlock: blockOf(metadata),
          shieldedDetailsPending: false,
        }),
      catch: (e) => new TransactionHistoryError({ message: `Failed to complete history entry for ${hash}`, cause: e }),
    }),
});

export const makeDefaultTransactionHistoryService = (
  config: DefaultTransactionHistoryConfiguration,
  _getContext: () => unknown,
): TransactionHistoryService => {
  const txHistoryStorage = config.txHistoryStorage;
  const queryClientLayer = HttpQueryClient.layer({ url: config.indexerClientConnection.indexerHttpUrl });
  const retryWindow = config.transactionDetailsRetryWindow ?? Duration.minutes(2);
  const gotApplied = txHistoryStorage.gotApplied?.bind(txHistoryStorage);
  const appliedEntries = gotApplied === undefined ? undefined : appliedEntriesOf(txHistoryStorage, gotApplied);

  return {
    ...(appliedEntries === undefined ? {} : { appliedEntries }),

    put: (
      changes: ledger.ZswapStateChanges,
      metadata: TransactionDetails,
      protocolVersion: number,
    ): Effect.Effect<void, TransactionHistoryError> =>
      gotFinalizedShielded(txHistoryStorage, {
        ...convertUpdateToFinalizedInput(changes, metadata, protocolVersion),
        // Only a storage that records applied entries can hold this one as pending; written there, the flag clears.
        ...(appliedEntries === undefined ? {} : { shieldedDetailsPending: false }),
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
        // already-behind indexer. Two failures are transient: the typed "not yet indexed" one, and a `ServerError`
        // (indexer down, unreachable or 5xx), which clears once the indexer is back. Beyond the window they surface as
        // a `TransactionHistoryError`, which the caller tries again later. The others cannot succeed by waiting: an
        // invalid indexer URL, and a `ClientError` (a 4xx response, including 429, or a GraphQL error). They fail fast,
        // as a `TransactionHistoryError` marked `retryable: false` that no caller retries, instead of holding a lookup
        // permit for the whole window. Errors are told apart by tag, so a second copy of the networking module cannot
        // turn a transient one into a permanent one.
        Effect.retry({
          schedule: Schedule.exponential(Duration.seconds(1)).pipe(
            Schedule.either(Schedule.spaced(Duration.seconds(10))),
            Schedule.jittered,
            Schedule.upTo(retryWindow),
          ),
          while: (error) => error._tag === 'Wallet.TransactionHistory' || error._tag === 'ServerError',
        }),
        Effect.mapError(
          Match.valueTags({
            'Wallet.TransactionHistory': (error) => error,
            ServerError: (error) =>
              new TransactionHistoryError({
                message: `Failed to fetch transaction metadata for ${hash}`,
                cause: error,
              }),
            ClientError: (error) =>
              new TransactionHistoryError({
                message: `The transaction metadata query for ${hash} failed and will not be retried`,
                cause: error,
                retryable: false,
              }),
            InvalidProtocolSchemeError: (error) =>
              new TransactionHistoryError({
                message: `The indexer URL is invalid, so the transaction metadata query for ${hash} failed and will not be retried`,
                cause: error,
                retryable: false,
              }),
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
                  new TransactionHistoryError({
                    message: `No transaction found in storage for hash: ${hash}`,
                    retryable: false,
                  }),
                )
              : entry.lifecycle.finalizedBlock === undefined
                ? Effect.fail(
                    new BlocklessFinalizedEntryError({
                      message: `Transaction ${hash} is finalized but its history entry records no block (restored from a pre-lifecycle history, or not yet completed: details pending)`,
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
