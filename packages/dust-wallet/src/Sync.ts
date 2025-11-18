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
import { Effect, Either, Layer, ParseResult, pipe, Schema, Scope, Stream } from 'effect';
import { DustSecretKey, Event as LedgerEvent, LedgerParameters } from '@midnight-ntwrk/ledger-v6';
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
import { WalletError } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { Simulator, SimulatorState } from './Simulator.js';
import { DustCoreWallet } from './DustCoreWallet.js';
import { NetworkId } from './types/ledger.js';
import { Uint8ArraySchema } from './Serialization.js';

export interface SyncService<TState, TStartAux, TUpdate> {
  updates: (state: TState, auxData: TStartAux) => Stream.Stream<TUpdate, WalletError.WalletError, Scope.Scope>;
  ledgerParameters: () => Effect.Effect<LedgerParameters, WalletError.WalletError>;
}

export interface SyncCapability<TState, TUpdate> {
  applyUpdate: (state: TState, update: TUpdate) => TState;
}

export type IndexerClientConnection = {
  indexerHttpUrl: string;
  indexerWsUrl?: string;
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
  update: WalletSyncSubscription;
  secretKeys: SecretKeysResource;
};
export const WalletSyncUpdate = {
  create: (update: WalletSyncSubscription, secretKey: DustSecretKey): WalletSyncUpdate => {
    return {
      update,
      secretKeys: SecretKeysResource.create(secretKey),
    };
  },
};
export const makeDefaultSyncService = (
  config: DefaultSyncConfiguration,
): SyncService<DustCoreWallet, DustSecretKey, WalletSyncUpdate> => {
  const indexerSyncService = makeIndexerSyncService(config);
  return {
    updates: (
      state: DustCoreWallet,
      secretKey: DustSecretKey,
    ): Stream.Stream<WalletSyncUpdate, WalletError.WalletError, Scope.Scope> => {
      return pipe(
        indexerSyncService.subscribeWallet(state),
        Stream.map((data) => WalletSyncUpdate.create(data, secretKey)),
        Stream.provideSomeLayer(indexerSyncService.connectionLayer()),
      );
    },
    ledgerParameters: (): Effect.Effect<LedgerParameters, WalletError.WalletError> => {
      return Effect.gen(function* () {
        const query = yield* BlockHash;
        const result = yield* query({ offset: null });
        return result.block?.ledgerParameters;
      }).pipe(
        Effect.provide(indexerSyncService.queryClient()),
        Effect.scoped,
        Effect.catchAll((err) =>
          Effect.fail(WalletError.WalletError.other(`Encountered unexpected error: ${err.message}`)),
        ),
        Effect.flatMap((ledgerParameters) => {
          if (ledgerParameters === undefined) {
            return Effect.fail(WalletError.WalletError.other('Unable to fetch ledger parameters'));
          }
          return LedgerOps.ledgerTry(() => LedgerParameters.deserialize(Buffer.from(ledgerParameters, 'hex')));
        }),
      );
    },
  };
};

export type IndexerSyncService = {
  connectionLayer: () => Layer.Layer<SubscriptionClient, WalletError.WalletError, Scope.Scope>;
  subscribeWallet: (
    state: DustCoreWallet,
  ) => Stream.Stream<WalletSyncSubscription, WalletError.WalletError, Scope.Scope | SubscriptionClient>;
  queryClient: () => Layer.Layer<QueryClient, WalletError.WalletError, Scope.Scope>;
};

export const makeIndexerSyncService = (config: DefaultSyncConfiguration): IndexerSyncService => {
  return {
    queryClient(): Layer.Layer<QueryClient, WalletError.WalletError, Scope.Scope> {
      return pipe(
        HttpQueryClient.layer({ url: config.indexerClientConnection.indexerHttpUrl }),
        Layer.mapError((error) => WalletError.WalletError.other(error)),
      );
    },
    connectionLayer(): Layer.Layer<SubscriptionClient, WalletError.WalletError, Scope.Scope> {
      const { indexerClientConnection } = config;

      return ConnectionHelper.createWebSocketUrl(
        indexerClientConnection.indexerHttpUrl,
        indexerClientConnection.indexerWsUrl,
      ).pipe(
        Either.flatMap((url) => WsURL.make(url)),
        Either.match({
          onLeft: (error) => Layer.fail(error),
          onRight: (url: WsURL.WsURL) => WsSubscriptionClient.layer({ url }),
        }),
        Layer.mapError(
          (e: URLError) =>
            new WalletError.SyncWalletError({ message: 'Failed to to obtain correct indexer URLs', cause: e }),
        ),
      );
    },
    subscribeWallet(
      state: DustCoreWallet,
    ): Stream.Stream<WalletSyncSubscription, WalletError.WalletError, Scope.Scope | SubscriptionClient> {
      const { appliedIndex } = state.progress;

      return pipe(
        DustLedgerEvents.run({
          id: Number(appliedIndex),
        }),
        Stream.mapEffect((subscription) =>
          pipe(
            Schema.decodeUnknownEither(SyncEventsUpdateSchema)(subscription.dustLedgerEvents),
            Either.mapLeft((err) => new WalletError.SyncWalletError(err)),
            EitherOps.toEffect,
          ),
        ),
        Stream.mapError((error) => new WalletError.SyncWalletError(error)),
      );
    },
  };
};

export const makeDefaultSyncCapability = (): SyncCapability<DustCoreWallet, WalletSyncUpdate> => {
  return {
    applyUpdate(state: DustCoreWallet, wrappedUpdate: WalletSyncUpdate): DustCoreWallet {
      const { update, secretKeys } = wrappedUpdate;
      const nextIndex = BigInt(update.id);
      const highestRelevantWalletIndex = BigInt(update.maxId);

      // in case the nextIndex is less than or equal to the current appliedIndex
      // just update highestRelevantWalletIndex
      if (nextIndex <= state.progress.appliedIndex) {
        return state.updateProgress({ highestRelevantWalletIndex, isConnected: true });
      }

      const events = [update.raw].filter((event) => event !== null);
      return secretKeys((keys) =>
        state
          .applyEvents(keys, events, new Date())
          .updateProgress({ appliedIndex: nextIndex, highestRelevantWalletIndex, isConnected: true }),
      );
    },
  };
};

export const makeSimulatorSyncService = (
  config: SimulatorSyncConfiguration,
): SyncService<DustCoreWallet, DustSecretKey, SimulatorSyncUpdate> => {
  return {
    updates: (_state: DustCoreWallet, secretKey: DustSecretKey) =>
      config.simulator.state$.pipe(Stream.map((state) => ({ update: state, secretKey }))),
    ledgerParameters: (): Effect.Effect<LedgerParameters> =>
      pipe(
        config.simulator.getLatestState(),
        Effect.map((state) => state.ledger.parameters),
      ),
  };
};

export const makeSimulatorSyncCapability = (): SyncCapability<DustCoreWallet, SimulatorSyncUpdate> => ({
  applyUpdate: (state: DustCoreWallet, update: SimulatorSyncUpdate) =>
    state
      .applyEvents(
        update.secretKey,
        update.update.lastTxResult?.events || [],
        DateOps.secondsToDate(update.update.lastTxNumber),
      )
      .updateProgress({ appliedIndex: update.update.lastTxNumber }),
});
