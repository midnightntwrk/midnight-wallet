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
import {
  Effect,
  Either,
  Layer,
  ParseResult,
  pipe,
  Schema,
  type Scope,
  Stream,
  Duration,
  Chunk,
  Schedule,
} from 'effect';
import { type DustSecretKey, Event as LedgerEvent, LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { BlockHash, DustLedgerEvents } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import {
  WsSubscriptionClient,
  HttpQueryClient,
  ConnectionHelper,
  type SubscriptionClient,
  type QueryClient,
} from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { EitherOps, LedgerOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { type URLError, WsURL } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { OtherWalletError, SyncWalletError, type WalletError } from './WalletError.js';
import {
  type Simulator,
  type SimulatorState,
  getBlockEventsFrom,
  getLastBlock,
} from '@midnight-ntwrk/wallet-sdk-capabilities/simulation';
import { CoreWallet } from './CoreWallet.js';
import { type NetworkId } from './types/ledger.js';
import { Uint8ArraySchema } from './Serialization.js';

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

const LedgerEventSchema = Schema.declare(
  (input: unknown): input is LedgerEvent => input instanceof LedgerEvent,
).annotations({
  identifier: 'ledger.Event',
});

const LedgerEventFromUInt8Array: Schema.Schema<LedgerEvent, Uint8Array> = Schema.asSchema(
  Schema.transformOrFail(Uint8ArraySchema, LedgerEventSchema, {
    encode: (e) => {
      return Effect.try({
        try: () => e.serialize(),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not serialize Ledger Event');
        },
      });
    },
    decode: (bytes) =>
      Effect.try({
        try: () => LedgerEvent.deserialize(bytes),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize Ledger Event');
        },
      }),
  }),
);

const HexedEvent: Schema.Schema<LedgerEvent, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(LedgerEventFromUInt8Array),
);

export const SyncEventsUpdateSchema = Schema.Struct({
  id: Schema.Number,
  raw: HexedEvent,
  maxId: Schema.Number,
});

export type WalletSyncSubscription = Schema.Schema.Type<typeof SyncEventsUpdateSchema>;

export type WalletSyncUpdate = {
  updates: WalletSyncSubscription[];
  secretKey: DustSecretKey;
  timestamp: Date;
};
export const WalletSyncUpdate = {
  create: (updates: WalletSyncSubscription[], secretKey: DustSecretKey, timestamp: Date): WalletSyncUpdate => {
    return {
      updates,
      secretKey,
      timestamp,
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

export type IndexerSyncService = {
  connectionLayer: () => Layer.Layer<SubscriptionClient, WalletError, Scope.Scope>;
  subscribeWallet: (
    state: CoreWallet,
  ) => Stream.Stream<WalletSyncSubscription, WalletError, Scope.Scope | SubscriptionClient>;
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
          (e: URLError) => new SyncWalletError({ message: 'Failed to to obtain correct indexer URLs', cause: e }),
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

export const makeSimulatorSyncService = (
  config: SimulatorSyncConfiguration,
): SyncService<CoreWallet, DustSecretKey, SimulatorSyncUpdate> => {
  return {
    updates: (_state: CoreWallet, secretKey: DustSecretKey) => {
      // Get the initial state immediately to ensure we process the genesis block.
      // Then subscribe to state$ for subsequent changes, but deduplicate by block number
      // to avoid processing the same block twice.
      let lastSeenBlockNumber: bigint | undefined;

      return pipe(
        Stream.fromEffect(config.simulator.getLatestState()),
        Stream.concat(config.simulator.state$),
        Stream.filter((state) => {
          const lastBlock = getLastBlock(state);
          if (lastBlock === undefined) {
            return false; // Skip blank state
          }
          const blockNumber = lastBlock.number;
          // Skip if we've already seen this block (deduplication)
          if (lastSeenBlockNumber !== undefined && blockNumber <= lastSeenBlockNumber) {
            return false;
          }
          lastSeenBlockNumber = blockNumber;
          return true;
        }),
        Stream.map((state) => ({ update: state, secretKey })),
      );
    },
    blockData: (): Effect.Effect<BlockData> => {
      return Effect.gen(function* () {
        const state = yield* config.simulator.getLatestState();
        const lastBlock = getLastBlock(state);
        // Use currentTime instead of lastBlock.timestamp for time-sensitive operations
        // (e.g., Dust generation calculation). The currentTime reflects any fast-forwarding
        // that has been done, while lastBlock.timestamp only reflects when the block was produced.
        return {
          hash: lastBlock.hash,
          height: Number(lastBlock.number),
          ledgerParameters: state.ledger.parameters,
          timestamp: state.currentTime,
        };
      });
    },
  };
};

export const makeSimulatorSyncCapability = (): SyncCapability<CoreWallet, SimulatorSyncUpdate> => {
  return {
    applyUpdate: (state: CoreWallet, update: SimulatorSyncUpdate) => {
      const lastBlock = getLastBlock(update.update);
      // If no block exists yet (blank simulator), skip update
      if (lastBlock === undefined) {
        return state;
      }
      // Get all events from blocks starting at appliedIndex (the next block to process).
      // appliedIndex semantics: the first block number we haven't processed yet.
      // Initial: appliedIndex = 0 (haven't processed any blocks)
      // After processing block N: appliedIndex = N + 1 (next block to process)
      const events = [...getBlockEventsFrom(update.update, state.progress.appliedIndex)];
      return CoreWallet.updateProgress(CoreWallet.applyEvents(state, update.secretKey, events, lastBlock.timestamp), {
        appliedIndex: lastBlock.number + 1n,
      });
    },
  };
};
