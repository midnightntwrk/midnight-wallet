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
  Option,
} from 'effect';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { LedgerParametersCodec } from '@midnightntwrk/wallet-sdk-capabilities/codecs';
import {
  type DustSecretKey,
  type DustStateChanges,
  Event as LedgerEvent,
  LedgerParameters,
} from '@midnight-ntwrk/ledger-v8';
import { BlockHash, DustLedgerEvents } from '@midnightntwrk/wallet-sdk-indexer-client';
import {
  WsSubscriptionClient,
  HttpQueryClient,
  ConnectionHelper,
  type SubscriptionClient,
  type QueryClient,
} from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { type URLError, WsURL } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { OtherWalletError, SyncWalletError, type WalletError } from './WalletError.js';
import { V8 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
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
  /** The protocol version the indexer reported this block under, and so the ledger version its parameters are in. */
  protocolVersion: number;
  ledgerParameters: LedgerParameters;
  timestamp: Date;
}

/**
 * The ledger parameters codecs this variant reads blocks with, unless it is told otherwise.
 *
 * @remarks
 *   Open-ended from the minimum supported version, so a wallet whose variant has not been given a narrower range keeps
 *   reading every block exactly as it did before this became routable. A two-variant dust wallet replaces this with a
 *   registry bounded by the range its variant is active over, and then a block from the other side of the boundary is
 *   refused by name instead of being deserialized.
 */
export const defaultLedgerParametersCodecs: LedgerParametersCodec.LedgerParametersCodecs<LedgerParameters> =
  Either.getOrThrow(
    LedgerParametersCodec.makeCodecs([
      {
        sinceVersion: ProtocolVersion.MinSupportedVersion,
        codec: LedgerParametersCodec.fromDeserializer((bytes: Uint8Array) => LedgerParameters.deserialize(bytes)),
      },
    ]),
  );

export type ChangesResult = {
  readonly changes: DustStateChanges[];
  readonly protocolVersion: number;
};

export interface SyncCapability<TState, TUpdate, TResult> {
  /**
   * Folds a sync update into the wallet state.
   *
   * @param state The state to fold into.
   * @param update The update to apply.
   * @param activeRange The half-open protocol version range the running variant owns. Anything the source reports at or
   *   beyond its end belongs to a later variant and must be left unapplied for that variant to fetch.
   */
  applyUpdate: (
    state: TState,
    update: TUpdate,
    activeRange: ProtocolVersion.ProtocolVersion.Range,
  ) => [TState, TResult];
}

/** The result of splitting a batch of version-tagged items at a variant's activation boundary. */
export type BoundarySplit<T> = {
  /** The leading items this variant owns, in source order. */
  readonly applied: readonly T[];
  /** The trailing items belonging to a later protocol version, left for the next variant to re-fetch. */
  readonly deferred: readonly T[];
  /**
   * The protocol version to record on the state: the first deferred item's version when there is one — that is the
   * signal that triggers migration — otherwise the last version any applied item reported. `None` when the batch was
   * empty, and also when nothing in it reported a version at all.
   */
  readonly observedVersion: Option.Option<ProtocolVersion.ProtocolVersion>;
};

/**
 * Splits a batch of version-tagged items at the end of a variant's activation range.
 *
 * @remarks
 *   The split is positional, not a filter: everything from the first out-of-range item onwards is deferred, even if a
 *   later item reports an in-range version again. A batch is a contiguous slice of one timeline, so applying past a
 *   boundary and then resuming behind it would leave a hole no cursor can describe.
 *
 *   An item whose version is `undefined` is treated as in-range and contributes no annotation: an absent value means "the
 *   indexer did not say", which must keep the un-versioned behaviour exactly, rather than being read as version zero
 *   and dragging the recorded version down.
 *
 *   This is the one place the boundary rule lives; the indexer capability (per event) and the simulator capability (per
 *   block) both go through it, so they cannot drift apart.
 * @param items The batch, in source order.
 * @param versionOf Reads the protocol version an item was reported at, or `undefined` if it carries none.
 * @param activeRange The variant's half-open activation range.
 * @returns The applied/deferred split and the version to record.
 */
export const splitAtVersionBoundary = <T>(
  items: readonly T[],
  versionOf: (item: T) => number | undefined,
  activeRange: ProtocolVersion.ProtocolVersion.Range,
): BoundarySplit<T> => {
  const [, end] = activeRange;
  const boundary = items.findIndex((item) => {
    const version = versionOf(item);
    return version !== undefined && BigInt(version) >= end;
  });
  const [applied, deferred] =
    boundary < 0 ? [items, [] as readonly T[]] : [items.slice(0, boundary), items.slice(boundary)];
  // The first deferred item is the hand-over signal. Failing that, the last applied item that actually reported a
  // version — searching backwards so a trailing untagged item does not erase an earlier tagged one.
  const signalling = deferred.at(0) ?? [...applied].reverse().find((item) => versionOf(item) !== undefined);
  const signalledVersion = signalling === undefined ? undefined : versionOf(signalling);

  return {
    applied,
    deferred,
    observedVersion:
      signalledVersion === undefined
        ? Option.none()
        : Option.some(ProtocolVersion.ProtocolVersion(BigInt(signalledVersion))),
  };
};

/** Records a batch's observed protocol version on the state, monotonically. A batch that observed none is a no-op. */
export const annotateVersion = (
  state: CoreWallet,
  observedVersion: Option.Option<ProtocolVersion.ProtocolVersion>,
): CoreWallet =>
  Option.match(observedVersion, {
    onNone: () => state,
    onSome: (version) => CoreWallet.withProtocolVersion(state, version),
  });

export type IndexerClientConnection = {
  indexerHttpUrl: string;
  indexerWsUrl?: string;
  keepAlive?: number;
  /** Cap on the in-flight event queue between the WebSocket push and the apply loop. Default: 10000. */
  bufferSize?: number;
  /** In-flight count at which the disposed WS subscription is reopened. Default: 100. */
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
  networkId: NetworkId;
  batchUpdates?: BatchUpdatesConfig;
  /** The ledger parameters codecs blocks are read with; defaults to {@link defaultLedgerParametersCodecs}. */
  ledgerParametersCodecs?: LedgerParametersCodec.LedgerParametersCodecs<LedgerParameters>;
};

export type SimulatorSyncConfiguration = {
  simulator: V8.Simulator;
  networkId: NetworkId;
};

export type SimulatorSyncUpdate = {
  update: V8.SimulatorState;
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
    encode: (e) =>
      Effect.try({
        try: () => e.serialize(),
        catch: (err) => new ParseResult.Unexpected(err, 'Could not serialize Ledger Event'),
      }),
    decode: (bytes) =>
      Effect.try({
        try: () => LedgerEvent.deserialize(bytes),
        catch: (err) => new ParseResult.Unexpected(err, 'Could not deserialize Ledger Event'),
      }),
  }),
);

const HexedEvent: Schema.Schema<LedgerEvent, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(LedgerEventFromUInt8Array),
);

export const SyncEventsUpdateSchema = Schema.Struct({
  id: Schema.Number,
  /**
   * The event as the indexer served it, still encoded.
   *
   * @remarks
   *   Whether this ledger version may read the event at all is not the subscription's question to answer. A batch
   *   spanning a protocol boundary carries events of the version that follows this one, which this ledger version
   *   cannot deserialize — the serialization header names a different version — and after a hand-over the inclusive
   *   cursor re-delivers an event of the version that preceded it, which it equally cannot. Both are ordinary, and
   *   neither is an error: they belong to the variant either side.
   *
   *   So the bytes travel undecoded and only the capability, which knows its own activation range, reads the ones it is
   *   about to apply — see {@link readEvent}. Decoding here would fail the whole batch on an event nobody intended to
   *   apply, and the stream would retry that same batch forever.
   */
  raw: Schema.String,
  maxId: Schema.Number,
  /**
   * The protocol version the indexer reported this event under, when it reports one at all.
   *
   * @remarks
   *   Optional rather than required, because an absent value has to keep meaning "the indexer did not say" — which is
   *   treated as in-range: the event applies normally and the wallet's recorded version is left alone. Reading it as
   *   zero instead would drag the recorded version down and, on a wallet already past the boundary, look like a
   *   migration backwards. The subscription itself does select the field.
   */
  protocolVersion: Schema.optional(Schema.Number),
});

export type WalletSyncSubscription = Schema.Schema.Type<typeof SyncEventsUpdateSchema>;

/**
 * Reads an event this variant is going to apply.
 *
 * @remarks
 *   The counterpart of {@link SyncEventsUpdateSchema} carrying its event encoded: a capability calls this on the batch
 *   prefix it owns, and never on what it defers. Failure here is a genuine one — an event this variant claimed and
 *   cannot read — and is raised rather than returned, because `SyncCapability.applyUpdate` is total in its own domain
 *   and the variant already turns a throw from it into a typed synchronization error.
 * @param event The event-carrying item to read.
 * @returns The event it carries.
 * @throws ParseError if the bytes are not an event this ledger version can deserialize.
 */
export const readEvent = (event: { readonly raw: string }): LedgerEvent => Schema.decodeSync(HexedEvent)(event.raw);

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
        Effect.flatMap((blockData): Effect.Effect<BlockData, WalletError> => {
          if (!blockData) {
            // A cold indexer (or one mid-reorg) resolves the query with `block: null`. That is an expected
            // condition, so it belongs in the typed error channel: a synchronous `throw` here would become a
            // defect, slipping past every `catchAll` a caller has installed.
            return Effect.fail(new OtherWalletError({ message: 'Unable to fetch block data' }));
          }
          // TODO: convert to schema
          return pipe(
            LedgerParametersCodec.decode(
              config.ledgerParametersCodecs ?? defaultLedgerParametersCodecs,
              ProtocolVersion.ProtocolVersion(BigInt(blockData.protocolVersion)),
              blockData.ledgerParameters,
            ),
            Either.map((ledgerParameters): BlockData => ({
              hash: blockData.hash,
              height: blockData.height,
              protocolVersion: blockData.protocolVersion,
              ledgerParameters,
              timestamp: new Date(blockData.timestamp),
            })),
            Either.mapLeft((error) => new SyncWalletError({ message: error.message, cause: error })),
            EitherOps.toEffect,
          );
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
          (e: URLError) => new SyncWalletError({ message: 'Failed to obtain correct indexer URLs', cause: e }),
        ),
      );
    },
    subscribeWallet(
      state: CoreWallet,
    ): Stream.Stream<WalletSyncSubscription, WalletError, Scope.Scope | SubscriptionClient> {
      const { appliedIndex } = state.progress;
      const bufferSize = config.indexerClientConnection.bufferSize ?? 10000;
      const resumeThreshold = config.indexerClientConnection.resumeThreshold ?? 100;

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

      return pipe(
        // Backpressure caps the in-flight queue between the WS push and the
        // apply loop. Without it the JS heap grows linearly with catch-up
        // depth, since `Stream.asyncPush({ bufferSize: 'unbounded' })`
        // buffers every event the indexer pushes regardless of apply rate.
        DustLedgerEvents.runWithBackpressure({
          bufferSize,
          resumeThreshold,
          from: resumeFrom,
          // `resumeFrom < 0n` means a fresh wallet: send no `id` so the indexer streams from the very
          // start, rather than relying on `id: 0` sorting below the first real event id.
          variables: (cursor) => ({ id: cursor < 0n ? null : Number(cursor) }),
          key: (r) => BigInt(r.dustLedgerEvents.id),
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

export const makeDefaultSyncCapability = (): SyncCapability<CoreWallet, WalletSyncUpdate, ChangesResult> => {
  return {
    applyUpdate(
      state: CoreWallet,
      wrappedUpdate: WalletSyncUpdate,
      activeRange: ProtocolVersion.ProtocolVersion.Range,
    ): [CoreWallet, ChangesResult] {
      const { updates, secretKey } = wrappedUpdate;

      // Nothing to update yet
      if (updates.length === 0) {
        return [state, { changes: [], protocolVersion: Number(state.protocolVersion) }];
      }

      const appliedIndex = state.progress.appliedIndex;
      const freshUpdates = updates.filter((u) => BigInt(u.id) > appliedIndex);

      // The tip is a property of the source, not of what this variant chose to apply, so it is read from the batch
      // tail even when the tail belongs to the next protocol version.
      const highestRelevantWalletIndex = BigInt(updates.at(-1)!.maxId);

      const { applied, observedVersion } = splitAtVersionBoundary(
        freshUpdates,
        (update) => update.protocolVersion,
        activeRange,
      );

      // Read here and nowhere earlier: `applied` is exactly the slice this variant owns, so nothing outside its
      // activation range — nor anything below its cursor — is ever handed to this ledger version's deserializer.
      const [newState, changes]: [CoreWallet, DustStateChanges[]] =
        applied.length === 0
          ? [state, []]
          : CoreWallet.applyEventsWithChanges(state, secretKey, applied.map(readEvent), wrappedUpdate.timestamp);

      // `appliedIndex` stops at the last event this variant actually replayed. The next variant resumes one below it
      // on an inclusive cursor, so the deferred suffix is re-fetched rather than skipped.
      const updatedState = CoreWallet.updateProgress(annotateVersion(newState, observedVersion), {
        appliedIndex: applied.length === 0 ? appliedIndex : BigInt(applied.at(-1)!.id),
        highestRelevantWalletIndex,
        isConnected: true,
      });

      return [
        updatedState,
        {
          changes,
          // Tags the changes that were actually produced, so tx-history records the version they were applied under
          // rather than the one that is about to trigger the hand-over.
          protocolVersion:
            [...applied].reverse().find((u) => u.protocolVersion !== undefined)?.protocolVersion ??
            Number(state.protocolVersion),
        },
      ];
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
          const lastBlock = V8.getLastBlock(state);
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
        const lastBlock = V8.getLastBlock(state);
        // Use currentTime instead of lastBlock.timestamp for time-sensitive operations
        // (e.g., Dust generation calculation). The currentTime reflects any fast-forwarding
        // that has been done, while lastBlock.timestamp only reflects when the block was produced.
        return {
          hash: lastBlock.hash,
          height: Number(lastBlock.number),
          protocolVersion: Number(lastBlock.protocolVersion),
          ledgerParameters: state.ledger.parameters,
          timestamp: state.currentTime,
        };
      });
    },
  };
};

export const makeSimulatorSyncCapability = (): SyncCapability<CoreWallet, SimulatorSyncUpdate, ChangesResult> => {
  return {
    applyUpdate: (
      state: CoreWallet,
      update: SimulatorSyncUpdate,
      activeRange: ProtocolVersion.ProtocolVersion.Range,
    ): [CoreWallet, ChangesResult] => {
      const lastBlock = V8.getLastBlock(update.update);
      // If no block exists yet (blank simulator), skip update
      if (lastBlock === undefined) {
        return [state, { changes: [], protocolVersion: Number(state.protocolVersion) }];
      }

      // appliedIndex semantics: the first block number we haven't processed yet.
      // Initial: appliedIndex = 0 (haven't processed any blocks)
      // After processing block N: appliedIndex = N + 1 (next block to process)
      //
      // The boundary is applied at block granularity here — a block carries exactly one protocol version, stamped when
      // it was produced — but it is the same rule and the same helper the indexer path uses. Blocks are walked
      // individually rather than through `getBlockEventsFrom` so that the split has something to cut.
      const pending = update.update.blocks.filter((block) => block.number >= state.progress.appliedIndex);
      const { applied, observedVersion } = splitAtVersionBoundary(
        pending,
        (block) => Number(block.protocolVersion),
        activeRange,
      );

      const events = applied.flatMap((block) => block.transactions.flatMap((tx) => tx.result.events));
      const lastAppliedBlock = applied.at(-1);

      const [newState, changes] =
        applied.length === 0
          ? [state, []]
          : CoreWallet.applyEventsWithChanges(state, update.secretKey, events, lastAppliedBlock!.timestamp);

      const updatedState = CoreWallet.updateProgress(annotateVersion(newState, observedVersion), {
        appliedIndex: lastAppliedBlock === undefined ? state.progress.appliedIndex : lastAppliedBlock.number + 1n,
      });
      return [
        updatedState,
        {
          changes,
          protocolVersion:
            lastAppliedBlock === undefined ? Number(state.protocolVersion) : Number(lastAppliedBlock.protocolVersion),
        },
      ];
    },
  };
};
