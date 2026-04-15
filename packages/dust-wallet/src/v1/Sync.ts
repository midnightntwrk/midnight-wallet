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
import { Effect, Either, Layer, pipe, Schema, Scope, Stream, Duration, Chunk, Schedule, Encoding } from 'effect';
import { DustSecretKey, LedgerParameters, dustNullifier, DustNullifier } from '@midnight-ntwrk/ledger-v8';
import {
  AddressDustGenerations,
  BlockHash,
  DustLedgerEvents,
  DustNullifierTransactions,
} from '@midnight-ntwrk/wallet-sdk-indexer-client';
import {
  WsSubscriptionClient,
  HttpQueryClient,
  ConnectionHelper,
  SubscriptionClient,
  QueryClient,
} from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { DateOps, EitherOps, LedgerOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { URLError, WsURL } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { OtherWalletError, SyncWalletError, WalletError } from './WalletError.js';
import { Simulator, SimulatorState } from './Simulator.js';
import { CoreWallet, SyncedDustNullifier } from './CoreWallet.js';
import { NetworkId } from './types/ledger.js';
import {
  DustGenerationsSubscription,
  DustGenerationsSubscriptionSchema,
  DustGenerationsSyncUpdate,
  DustNullifierTransactionsSubscription,
  DustNullifierTransactionSubscriptionSchema,
  SyncEventsUpdateSchema,
  WalletSyncSubscription,
  WalletSyncUpdate,
} from './SyncSchema.js';

export interface SyncService<TState, TStartAux, TUpdate> {
  updates: (state: TState, auxData: TStartAux) => Stream.Stream<TUpdate, WalletError, Scope.Scope>;
  blockData: () => Effect.Effect<BlockData, WalletError>;
}

// TODO: use schema instead
export interface BlockData {
  hash: string;
  height: number;
  ledgerParameters: LedgerParameters;
  timestamp: Date;
}

export interface SyncCapability<TState, TUpdate> {
  applyUpdate: (state: TState, update: TUpdate) => TState;
}

export type IndexerClientConnection = {
  indexerHttpUrl: string;
  indexerWsUrl?: string;
  keepAlive?: number;
};

export type BatchUpdatesConfig = {
  /** Maximum number of events to collect into a single batch before emitting.
   *  @default 10 */
  readonly size?: number;
  /** Maximum time in milliseconds to wait for a full batch before emitting a partial one.
   *  Controls the `groupedWithin` timeout — lower values mean more responsive
   *  (but smaller) batches when events arrive slowly.
   *  @default 1 */
  readonly timeout?: number;
  /** Minimum delay in milliseconds injected between consecutive batches.
   *  Prevents the sync stream from saturating downstream consumers when many
   *  events are available at once. Set to 0 to disable spacing entirely.
   *  @default 4 */
  readonly spacing?: number;
};

export type DefaultSyncConfiguration = {
  indexerClientConnection: IndexerClientConnection;
  networkId: NetworkId;
  batchUpdates?: BatchUpdatesConfig;
};

export type SimulatorSyncConfiguration = {
  simulator: Simulator;
  networkId: NetworkId;
};

export type SimulatorSyncUpdate = {
  update: SimulatorState;
  secretKey: DustSecretKey;
};

export type SecretKeysResource = <A>(cb: (key: DustSecretKey) => A) => A;
export const SecretKeysResource = {
  create: (secretKey: DustSecretKey): SecretKeysResource => {
    return (cb) => {
      const result = cb(secretKey);
      secretKey.clear();
      return result;
    };
  },
};

export const makeDefaultSyncService = (
  config: DefaultSyncConfiguration,
): SyncService<CoreWallet, DustSecretKey, WalletSyncUpdate> => {
  const indexerSyncService = makeIndexerSyncService(config);
  return {
    updates: (
      state: CoreWallet,
      secretKey: DustSecretKey,
    ): Stream.Stream<WalletSyncUpdate, WalletError, Scope.Scope> => {
      const batchSize = config.batchUpdates?.size ?? 10;
      const batchTimeout = Duration.millis(config.batchUpdates?.timeout ?? 1);
      const batchSpacing = config.batchUpdates?.spacing ?? 4;

      return pipe(
        indexerSyncService.subscribeWallet(state),
        Stream.groupedWithin(batchSize, batchTimeout),
        Stream.map(Chunk.toArray),
        Stream.map((data) => WalletSyncUpdate.create(data, secretKey, new Date())),
        batchSpacing > 0
          ? Stream.schedule(Schedule.spaced(Duration.millis(batchSpacing)))
          : (eventsStream) => eventsStream,
        Stream.provideSomeLayer(indexerSyncService.connectionLayer()),
      );
    },
    blockData: (): Effect.Effect<BlockData, WalletError> => {
      return Effect.gen(function* () {
        const query = yield* BlockHash;
        const result = yield* query({ offset: null });
        return result.block;
      }).pipe(
        Effect.provide(indexerSyncService.queryClient()),
        Effect.scoped,
        Effect.catchAll((err) =>
          Effect.fail(new OtherWalletError({ message: `Encountered unexpected error: ${err.message}`, cause: err })),
        ),
        Effect.flatMap((blockData) => {
          if (!blockData) {
            throw new OtherWalletError({ message: 'Unable to fetch block data' });
          }
          // TODO: convert to schema
          return LedgerOps.ledgerTry(() => ({
            hash: blockData.hash,
            height: blockData.height,
            ledgerParameters: LedgerParameters.deserialize(Buffer.from(blockData.ledgerParameters, 'hex')),
            timestamp: new Date(blockData.timestamp),
          }));
        }),
      );
    },
  };
};

export const makeDustGenerationsSyncService = (
  config: DefaultSyncConfiguration,
): SyncService<CoreWallet, DustSecretKey, DustGenerationsSyncUpdate> => {
  const defaultSyncService = makeDefaultSyncService(config);
  const indexerSyncService = makeIndexerSyncService(config);
  return {
    updates: (
      state: CoreWallet,
      secretKey: DustSecretKey,
    ): Stream.Stream<DustGenerationsSyncUpdate, WalletError, Scope.Scope> => {
      return pipe(
        Stream.fromEffect(defaultSyncService.blockData()),
        Stream.flatMap((blockData) => indexerSyncService.subscribeDustGenerations(state, blockData.height)),
        Stream.runCollect,
        Stream.map(Chunk.toArray),
        Stream.map((updates) => DustGenerationsSyncUpdate.create(updates, secretKey, new Date())),
        Stream.provideSomeLayer(indexerSyncService.connectionLayer()),
      );
    },
    blockData: (): Effect.Effect<BlockData, WalletError> => defaultSyncService.blockData(),
  };
};

export type IndexerSyncService = {
  connectionLayer: () => Layer.Layer<SubscriptionClient, WalletError, Scope.Scope>;
  subscribeWallet: (
    state: CoreWallet,
  ) => Stream.Stream<WalletSyncSubscription, WalletError, Scope.Scope | SubscriptionClient>;
  subscribeDustGenerations: (
    state: CoreWallet,
    latestBlock: number,
  ) => Stream.Stream<DustGenerationsSubscription, WalletError, Scope.Scope | SubscriptionClient>;
  subscribeDustNullifierTransactions: (
    dustNullifiers: DustNullifier[],
  ) => Stream.Stream<DustNullifierTransactionsSubscription, WalletError, Scope.Scope | SubscriptionClient>;
  queryClient: () => Layer.Layer<QueryClient, WalletError, Scope.Scope>;
};

export const makeIndexerSyncService = (config: DefaultSyncConfiguration): IndexerSyncService => {
  return {
    queryClient(): Layer.Layer<QueryClient, WalletError, Scope.Scope> {
      return pipe(
        HttpQueryClient.layer({
          url: config.indexerClientConnection.indexerHttpUrl,
        }),
        Layer.mapError((error) => new OtherWalletError(error)),
      );
    },
    connectionLayer(): Layer.Layer<SubscriptionClient, WalletError, Scope.Scope> {
      const { indexerClientConnection } = config;

      return ConnectionHelper.createWebSocketUrl(
        indexerClientConnection.indexerHttpUrl,
        indexerClientConnection.indexerWsUrl,
      ).pipe(
        Either.flatMap((url) => WsURL.make(url)),
        Either.match({
          onLeft: (error) => Layer.fail(error),
          onRight: (url: WsURL.WsURL) =>
            WsSubscriptionClient.layer({ url, keepAlive: indexerClientConnection.keepAlive }),
        }),
        Layer.mapError(
          (e: URLError) => new SyncWalletError({ message: 'Failed to obtain correct indexer URLs', cause: e }),
        ),
      );
    },
    subscribeWallet(
      state: CoreWallet,
    ): Stream.Stream<WalletSyncSubscription, WalletError, Scope.Scope | SubscriptionClient> {
      const { appliedIndex } = state.progress;

      return pipe(
        DustLedgerEvents.run({
          id: Number(appliedIndex),
        }),
        Stream.mapEffect((subscription) =>
          pipe(
            Schema.decodeUnknownEither(SyncEventsUpdateSchema)(subscription.dustLedgerEvents),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          ),
        ),
        Stream.mapError((error) => new SyncWalletError(error)),
      );
    },
    subscribeDustGenerations(
      state: CoreWallet,
      latestBlock: number,
    ): Stream.Stream<DustGenerationsSubscription, WalletError, Scope.Scope | SubscriptionClient> {
      const { appliedIndex } = state.progress;
      const { publicKey } = state.publicKey;

      return pipe(
        AddressDustGenerations.run({
          dustAddress: publicKey.toString(16),
          startIndex: Number(appliedIndex),
          endIndex: latestBlock,
        }),
        Stream.mapEffect((subscription) =>
          pipe(
            Schema.decodeUnknownEither(DustGenerationsSubscriptionSchema)(subscription.dustGenerations),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          ),
        ),
        Stream.mapError((error) => new SyncWalletError(error)),
      );
    },
    subscribeDustNullifierTransactions(
      dustNullifiers: DustNullifier[],
    ): Stream.Stream<DustNullifierTransactionsSubscription, WalletError, Scope.Scope | SubscriptionClient> {
      return pipe(
        DustNullifierTransactions.run({
          nullifierPrefixes: dustNullifiers.map((n) => n.toString().substring(0, n.toString().length / 2)),
          fromBlock: null,
          toBlock: null,
        }),
        Stream.mapEffect((subscription) =>
          pipe(
            Schema.decodeUnknownEither(DustNullifierTransactionSubscriptionSchema)(
              subscription.dustNullifierTransactions,
            ),
            // TODO: filter out unrelated records
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          ),
        ),
        Stream.mapError((error) => new SyncWalletError(error)),
      );
    },
  };
};

export const makeDefaultSyncCapability = (): SyncCapability<CoreWallet, WalletSyncUpdate> => {
  return {
    applyUpdate(state: CoreWallet, wrappedUpdate: WalletSyncUpdate): CoreWallet {
      const { updates, secretKey } = wrappedUpdate;

      // Nothing to update yet
      if (updates.length === 0) {
        return state;
      }

      const lastUpdate = updates.at(-1)!;
      const nextIndex = BigInt(lastUpdate.id);
      const highestRelevantWalletIndex = BigInt(lastUpdate.maxId);

      // in case the nextIndex is less than or equal to the current appliedIndex
      // just update highestRelevantWalletIndex
      if (nextIndex <= state.progress.appliedIndex) {
        return CoreWallet.updateProgress(state, { highestRelevantWalletIndex, isConnected: true });
      }

      const events = updates.map((u) => u.raw).filter((event) => event !== null);

      return CoreWallet.updateProgress(CoreWallet.applyEvents(state, secretKey, events, wrappedUpdate.timestamp), {
        appliedIndex: nextIndex,
        highestRelevantWalletIndex,
        isConnected: true,
      });
    },
  };
};

export const makeDustGenerationsSyncCapability = (): SyncCapability<CoreWallet, DustGenerationsSyncUpdate> => {
  return {
    applyUpdate(state: CoreWallet, wrappedUpdate: DustGenerationsSyncUpdate): CoreWallet {
      const publicKey = Encoding.encodeHex(state.publicKey.publicKey.toString());
      const { updates, secretKey } = wrappedUpdate;

      // Nothing to update yet
      if (updates.length === 0) {
        return state;
      }

      const lastUpdateIndex = updates
        .filter((u) => u.type === 'DustGenerationsProgress')
        .map((u) => u.highestIndex)
        .toSorted()
        .at(-1);

      const dustGenTreeUpdates = updates
        .map((u) => u.collapsedMerkleTree)
        .filter((u) => u !== undefined)
        .toSorted((u1, u2) => u1.startIndex - u2.startIndex);

      const nullifiers = updates
        .filter((u) => u.type === 'DustGenerationsItem')
        .filter((u) => u.owner === publicKey)
        .map((u) => {
          const qdo = {
            initialValue: BigInt(u.value),
            owner: state.publicKey.publicKey,
            nonce: BigInt(u.nonce),
            seq: 0,
            ctime: u.ctime,
            backingNight: '', // we don't need this to calculate the nullifier
            mtIndex: BigInt(u.merkleIndex),
          };
          return { dustNullifier: dustNullifier(qdo, secretKey), isSynced: false } as SyncedDustNullifier;
        });

      const updatedWallet = CoreWallet.applyDustGenerations(state, dustGenTreeUpdates, nullifiers);

      if (lastUpdateIndex !== undefined) {
        return CoreWallet.updateProgress(updatedWallet, {
          appliedIndex: BigInt(lastUpdateIndex),
          highestRelevantWalletIndex: BigInt(lastUpdateIndex),
          isConnected: true,
        });
      }

      return updatedWallet;
    },
  };
};

export const makeSimulatorSyncService = (
  config: SimulatorSyncConfiguration,
): SyncService<CoreWallet, DustSecretKey, SimulatorSyncUpdate> => {
  return {
    updates: (_state: CoreWallet, secretKey: DustSecretKey) =>
      config.simulator.state$.pipe(Stream.map((state) => ({ update: state, secretKey }))),
    blockData: (): Effect.Effect<BlockData> => {
      return Effect.gen(function* () {
        const state = yield* config.simulator.getLatestState();
        const timestamp = DateOps.secondsToDate(state.lastTxNumber);
        return {
          hash: yield* Simulator.blockHash(timestamp),
          height: Number(state.lastTxNumber),
          ledgerParameters: state.ledger.parameters,
          timestamp,
        };
      });
    },
  };
};

export const makeSimulatorSyncCapability = (): SyncCapability<CoreWallet, SimulatorSyncUpdate> => ({
  applyUpdate: (state: CoreWallet, update: SimulatorSyncUpdate) =>
    CoreWallet.updateProgress(
      CoreWallet.applyEvents(
        state,
        update.secretKey,
        update.update.lastTxResult?.events || [],
        DateOps.secondsToDate(update.update.lastTxNumber),
      ),
      { appliedIndex: update.update.lastTxNumber },
    ),
});
