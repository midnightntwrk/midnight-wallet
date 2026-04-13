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

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { Chunk, Duration, Effect, Either, ParseResult, pipe, Schedule, Schema, type Scope, Stream } from 'effect';
import { CoreWallet } from './CoreWallet.js';
import { type Simulator, type SimulatorState } from './Simulator.js';
import { ZswapEvents } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import { ConnectionHelper, WsSubscriptionClient } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { SyncWalletError, type WalletError } from './WalletError.js';
import { WsURL } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { type TransactionHistoryService } from './TransactionHistory.js';
import { EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';

export interface SyncService<TState, TStartAux, TUpdate> {
  updates: (state: TState, auxData: TStartAux) => Stream.Stream<TUpdate, WalletError, Scope.Scope>;
}

export type ChangesResult = {
  readonly changes: ledger.ZswapStateChanges[];
  readonly protocolVersion: number;
};

export interface SyncCapability<TState, TUpdate, TResult> {
  applyUpdate: (state: TState, update: TUpdate) => [TState, TResult];
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
  batchUpdates?: BatchUpdatesConfig;
};

export type DefaultSyncContext = {
  transactionHistoryService: TransactionHistoryService;
};

const Uint8ArraySchema = Schema.declare(
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
).annotations({
  identifier: 'Uint8Array',
});

export type SecretKeysResource = <A>(cb: (keys: ledger.ZswapSecretKeys) => A) => A;
export const SecretKeysResource = {
  create: (secretKeys: ledger.ZswapSecretKeys): SecretKeysResource => {
    return (cb) => {
      const result = cb(secretKeys);
      secretKeys.clear();
      return result;
    };
  },
};

export type WalletSyncUpdate = {
  updates: EventsSyncUpdate[];
  secretKeys: ledger.ZswapSecretKeys;
};
export const WalletSyncUpdate = {
  create: (updates: EventsSyncUpdate[], secretKeys: ledger.ZswapSecretKeys): WalletSyncUpdate => {
    return {
      updates,
      secretKeys,
    };
  },
};

const LedgerEventSchema = Schema.declare(
  (input: unknown): input is ledger.Event => input instanceof ledger.Event,
).annotations({
  identifier: 'ledger.Event',
});

const LedgerEventFromUint8Array: Schema.Schema<ledger.Event, Uint8Array> = Schema.transformOrFail(
  Uint8ArraySchema,
  LedgerEventSchema,
  {
    encode: (event) =>
      Effect.try({
        try: () => event.serialize(),
        catch: (error) => new ParseResult.Unexpected(error, 'Could not serialize ledger event'),
      }),
    decode: (bytes) =>
      Effect.try({
        try: () => ledger.Event.deserialize(bytes),
        catch: (error) => new ParseResult.Unexpected(error, 'Could not deserialize ledger event'),
      }),
  },
);

const HexedLedgerEvent: Schema.Schema<ledger.Event, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(LedgerEventFromUint8Array),
);

const EventsSyncUpdatePayload = Schema.Struct({
  id: Schema.Number,
  raw: Schema.String,
  protocolVersion: Schema.Number,
  maxId: Schema.Number,
});

export const EventsSyncUpdate = Schema.TaggedStruct('EventsSyncUpdate', {
  id: Schema.Number,
  protocolVersion: Schema.Number,
  maxId: Schema.Number,
  event: LedgerEventSchema,
});

export type EventsSyncUpdate = Schema.Schema.Type<typeof EventsSyncUpdate>;

const EventsSyncUpdateFromPayload = Schema.transformOrFail(EventsSyncUpdatePayload, EventsSyncUpdate, {
  decode: (input) =>
    pipe(
      Schema.decodeUnknownEither(HexedLedgerEvent)(input.raw),
      Either.map((event) => ({
        _tag: 'EventsSyncUpdate' as const,
        id: input.id,
        protocolVersion: input.protocolVersion,
        maxId: input.maxId,
        event,
      })),
      Either.mapLeft((error) => new ParseResult.Unexpected(error, 'Failed to decode ledger event payload')),
      EitherOps.toEffect,
    ),
  encode: (output) =>
    pipe(
      Schema.encodeEither(HexedLedgerEvent)(output.event),
      Either.map((raw) => ({
        id: output.id,
        raw,
        protocolVersion: output.protocolVersion,
        maxId: output.maxId,
      })),
      Either.mapLeft((error) => new ParseResult.Unexpected(error, 'Failed to encode ledger event payload')),
      EitherOps.toEffect,
    ),
});

export const makeEventsSyncService = (
  config: DefaultSyncConfiguration,
): SyncService<CoreWallet, ledger.ZswapSecretKeys, WalletSyncUpdate> => {
  return {
    updates: (
      state: CoreWallet,
      secretKeys: ledger.ZswapSecretKeys,
    ): Stream.Stream<WalletSyncUpdate, WalletError, Scope.Scope> => {
      const { indexerClientConnection } = config;

      const webSocketUrlResult = ConnectionHelper.createWebSocketUrl(
        indexerClientConnection.indexerHttpUrl,
        indexerClientConnection.indexerWsUrl,
      );
      if (Either.isLeft(webSocketUrlResult)) {
        return Stream.fail(
          new SyncWalletError(
            new Error(`Could not derive WebSocket URL from indexer HTTP URL: ${webSocketUrlResult.left.message}`),
          ),
        );
      }

      const indexerWsUrlResult = WsURL.make(webSocketUrlResult.right);

      if (Either.isLeft(indexerWsUrlResult)) {
        return Stream.fail(
          new SyncWalletError(new Error(`Invalid indexer WS URL: ${indexerWsUrlResult.left.message}`)),
        );
      }

      const indexerWsUrl = indexerWsUrlResult.right;
      const appliedIndex = state.progress?.appliedIndex ?? 0n;

      const batchSize = config.batchUpdates?.size ?? 10;
      const batchTimeout = Duration.millis(config.batchUpdates?.timeout ?? 1);
      const batchSpacing = config.batchUpdates?.spacing ?? 4;

      const eventsStream = pipe(
        ZswapEvents.run({ id: Number(appliedIndex) }),
        Stream.provideLayer(
          WsSubscriptionClient.layer({ url: indexerWsUrl, keepAlive: config.indexerClientConnection.keepAlive }),
        ),
        Stream.mapError((error) => new SyncWalletError(error)),
        Stream.mapEffect((subscription) =>
          pipe(
            subscription.zswapLedgerEvents,
            Schema.decodeUnknownEither(EventsSyncUpdateFromPayload),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          ),
        ),
        Stream.groupedWithin(batchSize, batchTimeout),
        Stream.map(Chunk.toArray),
        Stream.map((data) => WalletSyncUpdate.create(data, secretKeys)),
      );

      return batchSpacing > 0
        ? Stream.schedule(eventsStream, Schedule.spaced(Duration.millis(batchSpacing)))
        : eventsStream;
    },
  };
};

export const makeEventsSyncCapability = (): SyncCapability<CoreWallet, WalletSyncUpdate, ChangesResult> => {
  return {
    applyUpdate: (state: CoreWallet, wrappedUpdate: WalletSyncUpdate): [CoreWallet, ChangesResult] => {
      if (wrappedUpdate.updates.length === 0) {
        return [state, { changes: [], protocolVersion: Number(state.protocolVersion) }];
      }

      const lastUpdate = wrappedUpdate.updates.at(-1)!;
      const nextIndex = BigInt(lastUpdate.id);
      const highestRelevantWalletIndex = BigInt(lastUpdate.maxId);
      // in case the nextIndex is less than or equal to the appliedIndex
      // just update highestRelevantWalletIndex
      if (nextIndex <= state.progress.appliedIndex) {
        return [
          CoreWallet.updateProgress(state, {
            highestRelevantWalletIndex,
            isConnected: true,
          }),
          { changes: [], protocolVersion: lastUpdate.protocolVersion },
        ];
      }

      const [newState, newChanges] = CoreWallet.replayEventsWithChanges(
        state,
        wrappedUpdate.secretKeys,
        wrappedUpdate.updates.map((u) => u.event),
      );

      return [
        CoreWallet.updateProgress(newState, {
          highestRelevantWalletIndex,
          appliedIndex: nextIndex,
          isConnected: true,
        }),
        { changes: newChanges, protocolVersion: lastUpdate.protocolVersion },
      ];
    },
  };
};

export type SimulatorSyncConfiguration = {
  simulator: Simulator;
};

export type SimulatorSyncUpdate = {
  update: SimulatorState;
  secretKeys: ledger.ZswapSecretKeys;
};

export const makeSimulatorSyncService = (
  config: SimulatorSyncConfiguration,
): SyncService<CoreWallet, ledger.ZswapSecretKeys, SimulatorSyncUpdate> => {
  return {
    updates: (_state: CoreWallet, secretKeys: ledger.ZswapSecretKeys) =>
      config.simulator.state$.pipe(Stream.map((state) => ({ update: state, secretKeys: secretKeys }))),
  };
};

export const makeSimulatorSyncCapability = (): SyncCapability<CoreWallet, SimulatorSyncUpdate, ChangesResult> => {
  return {
    applyUpdate: (state: CoreWallet, update: SimulatorSyncUpdate): [CoreWallet, ChangesResult] => {
      const {
        update: {
          lastTxResult: { events },
        },
        secretKeys,
      } = update;
      const [newState, newChanges] = CoreWallet.replayEventsWithChanges(state, secretKeys, events);
      return [newState, { changes: newChanges, protocolVersion: Number(state.protocolVersion) }];
    },
  };
};
