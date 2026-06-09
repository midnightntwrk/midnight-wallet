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
import {
  type Simulator,
  type SimulatorState,
  getLastBlock,
  getBlockEventsFrom,
} from '@midnight-ntwrk/wallet-sdk-capabilities/simulation';
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
  /** Cap on the in-flight event queue between the WebSocket push and the apply loop. Default: 1000. */
  bufferSize?: number;
  /** In-flight count at which the disposed WS subscription is reopened. Default: 500. */
  resumeThreshold?: number;
};

export type BatchUpdatesConfig = {
  /**
   * Maximum number of events to collect into a single batch before emitting.
   *
   * @default 10
   */
  readonly size?: number;
  /**
   * Maximum time in milliseconds to wait for a full batch before emitting a partial one. Controls the `groupedWithin`
   * timeout — lower values mean more responsive (but smaller) batches when events arrive slowly.
   *
   * @default 1
   */
  readonly timeout?: number;
  /**
   * Minimum delay in milliseconds injected between consecutive batches. Prevents the sync stream from saturating
   * downstream consumers when many events are available at once. Set to 0 to disable spacing entirely.
   *
   * @default 4
   */
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

      // The boundary is load-bearing, not waste: this subscription emits only events (no tip/progress
      // sentinel), and `isConnected`/the tip (`maxId`) are set only when an event is received. So the
      // cursor must stay `<= appliedIndex` — never `appliedIndex + 1`. Requesting one event later would
      // deliver nothing to a wallet already at the tip, so `applyUpdate` would never run and sync would
      // hang.
      //
      // A fresh wallet has `appliedIndex === 0n` (the "nothing applied yet" sentinel), so `resumeFrom`
      // is `-1n` and the `variables` mapping below opens the subscription with no `id` — the indexer
      // streams from the very start. A restored wallet has `appliedIndex >= 1`, so `resumeFrom` is
      // `appliedIndex - 1` and the inclusive cursor re-delivers the boundary event.
      const resumeFrom = appliedIndex - 1n;

      const batchSize = config.batchUpdates?.size ?? 10;
      const batchTimeout = Duration.millis(config.batchUpdates?.timeout ?? 1);
      const batchSpacing = config.batchUpdates?.spacing ?? 4;
      const bufferSize = config.indexerClientConnection.bufferSize ?? 10000;
      const resumeThreshold = config.indexerClientConnection.resumeThreshold ?? 100;

      const eventsStream = pipe(
        // Backpressure caps the in-flight queue between the WS push and the
        // apply loop. Without it the JS heap grows linearly with catch-up
        // depth, since `Stream.asyncPush({ bufferSize: 'unbounded' })`
        // buffers every event the indexer pushes regardless of apply rate.
        ZswapEvents.runWithBackpressure({
          bufferSize,
          resumeThreshold,
          from: resumeFrom,
          // `resumeFrom < 0n` means a fresh wallet: send no `id` so the indexer streams from the very
          // start, rather than relying on `id: 0` sorting below the first real event id.
          variables: (cursor) => ({ id: cursor < 0n ? null : Number(cursor) }),
          key: (r) => BigInt(r.zswapLedgerEvents.id),
        }),
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

      // The subscription resumes at the last-applied index and its cursor is inclusive, so the
      // boundary event (id === appliedIndex) is re-delivered. Replaying it would re-insert
      // commitments already in the zswap state ("non-linear insertion" error), so only events
      // strictly after the applied index are replayed. The boundary is still used (below) to
      // refresh the tip and mark the wallet connected — that is how an already-caught-up wallet
      // learns it is synced when no new events exist.
      const appliedIndex = state.progress?.appliedIndex ?? 0n;
      const freshUpdates = wrappedUpdate.updates.filter((u) => BigInt(u.id) > appliedIndex);

      const lastUpdate = wrappedUpdate.updates.at(-1)!;
      const highestRelevantWalletIndex = BigInt(lastUpdate.maxId);

      const [newState, newChanges]: [CoreWallet, ledger.ZswapStateChanges[]] =
        freshUpdates.length === 0
          ? [state, []]
          : CoreWallet.replayEventsWithChanges(
              state,
              wrappedUpdate.secretKeys,
              freshUpdates.map((u) => u.event),
            );

      const updatedState = CoreWallet.updateProgress(newState, {
        highestRelevantWalletIndex,
        appliedIndex: freshUpdates.length === 0 ? appliedIndex : BigInt(freshUpdates.at(-1)!.id),
        isConnected: true,
      });

      return [updatedState, { changes: newChanges, protocolVersion: lastUpdate.protocolVersion }];
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
    updates: (_state: CoreWallet, secretKeys: ledger.ZswapSecretKeys) => {
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
        Stream.map((state) => ({ update: state, secretKeys })),
      );
    },
  };
};

export const makeSimulatorSyncCapability = (): SyncCapability<CoreWallet, SimulatorSyncUpdate, ChangesResult> => {
  return {
    applyUpdate: (state: CoreWallet, update: SimulatorSyncUpdate): [CoreWallet, ChangesResult] => {
      const { update: simulatorState, secretKeys } = update;
      const lastBlock = getLastBlock(simulatorState);
      if (lastBlock === undefined) {
        return [state, { changes: [], protocolVersion: Number(state.protocolVersion) }];
      }

      // Get all events from blocks starting at appliedIndex (the next block to process).
      // appliedIndex semantics: the first block number we haven't processed yet.
      // Initial: appliedIndex = 0 (haven't processed any blocks)
      // After processing block N: appliedIndex = N + 1 (next block to process)
      const events = [...getBlockEventsFrom(simulatorState, state.progress.appliedIndex)];
      const [newState, newChanges] = CoreWallet.replayEventsWithChanges(state, secretKeys, events);
      return [
        CoreWallet.updateProgress(newState, {
          appliedIndex: lastBlock.number + 1n,
        }),
        { changes: newChanges, protocolVersion: Number(state.protocolVersion) },
      ];
    },
  };
};
