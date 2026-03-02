// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { Effect, Either, Layer, ParseResult, pipe, Schema, Scope, Stream, Duration, Chunk, Schedule } from 'effect';
import { DustSecretKey, Event as LedgerEvent, LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { BlockHash, DustLedgerEvents } from '@midnight-ntwrk/wallet-sdk-indexer-client';
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
import { CoreWallet } from './CoreWallet.js';
import { NetworkId } from './types/ledger.js';
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

export type DefaultSyncConfiguration = {
  indexerClientConnection: IndexerClientConnection;
  networkId: NetworkId;
};

export type SimulatorSyncConfiguration = {
  simulator: Simulator;
  networkId: NetworkId;
};

export type SimulatorSyncUpdate = {
  update: SimulatorState;
  secretKey: DustSecretKey;
};

type SecretKeysResource = <A>(cb: (key: DustSecretKey) => A) => A;
export const SecretKeysResource = {
  create: (secretKey: DustSecretKey): SecretKeysResource => {
    let sk: DustSecretKey | null = secretKey;
    return (cb) => {
      if (sk === null || sk === undefined) {
        throw new Error('Secret key has been consumed');
      }
      const result = cb(sk);
      sk = null;
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
  secretKeys: SecretKeysResource;
  timestamp: Date;
};
export const WalletSyncUpdate = {
  create: (updates: WalletSyncSubscription[], secretKey: DustSecretKey, timestamp: Date): WalletSyncUpdate => {
    return {
      updates,
      secretKeys: SecretKeysResource.create(secretKey),
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
      const batchSize = 10;
      const batchTimeout = Duration.millis(1);

      return pipe(
        indexerSyncService.subscribeWallet(state),
        Stream.groupedWithin(batchSize, batchTimeout),
        Stream.map(Chunk.toArray),
        Stream.map((data) => WalletSyncUpdate.create(data, secretKey, new Date())),
        Stream.schedule(Schedule.spaced(Duration.millis(4))),
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
      const { updates, secretKeys } = wrappedUpdate;

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
      return secretKeys((keys) =>
        CoreWallet.updateProgress(CoreWallet.applyEvents(state, keys, events, wrappedUpdate.timestamp), {
          appliedIndex: nextIndex,
          highestRelevantWalletIndex,
          isConnected: true,
        }),
      );
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
