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
  identity,
} from 'effect';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { LedgerParametersCodec } from '@midnightntwrk/wallet-sdk-capabilities/codecs';
import {
  type DustSecretKey,
  type DustStateChanges,
  Event as LedgerEvent,
  LedgerParameters,
} from '@midnight-ntwrk/ledger-v8';
import { BlockHash, DustLedgerEventTip, DustLedgerEvents } from '@midnightntwrk/wallet-sdk-indexer-client';
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

/**
 * How often the sync source re-asks the chain which protocol version it is on.
 *
 * @remarks
 *   The event subscription this source reads has no progress arm: it says nothing at all when there is nothing to say. A
 *   wallet therefore observes the chain's protocol version only through dust events, and on a chain that crosses a
 *   protocol boundary and then produces no dust traffic it observes no version at all — it stays on the variant it was
 *   running, and everything built through it stays routed to that variant's ledger. Asking on a timer is what closes
 *   that, and the cost of asking is one small query per interval on a chain that has not moved.
 */
export type VersionWatchConfig = {
  /**
   * Milliseconds between checks. Zero or less turns the watcher off entirely, which is what a source driving a wallet
   * from something other than a live chain wants.
   *
   * @default 30000
   */
  readonly intervalMs?: number;
};

export type DefaultSyncConfiguration = {
  indexerClientConnection: IndexerClientConnection;
  networkId: NetworkId;
  batchUpdates?: BatchUpdatesConfig;
  versionWatch?: VersionWatchConfig;
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

/** The ordinary arm of {@link WalletSyncUpdate}: a batch of the indexer's dust event timeline, still encoded. */
export type EventsWalletSyncUpdate = {
  _tag: 'Events';
  updates: WalletSyncSubscription[];
  secretKey: DustSecretKey;
  timestamp: Date;
};

/**
 * What the chain says about itself when its dust timeline says nothing.
 *
 * @remarks
 *   An observation, not a piece of the chain: it moves no cursor, inserts nothing and produces no changes. All it can do
 *   is record a protocol version, which is enough, because recording one outside the running variant's activation range
 *   is exactly what makes the runtime hand over.
 *
 *   `highestEventId` is what makes the record safe to make. Handing over parks the sync cursor where it stands, and the
 *   variant that takes over re-fetches from there — so an event still unread below the source's tip would reach it as
 *   bytes of the version that preceded it, which its ledger cannot deserialize. The signal therefore travels with the
 *   far end of the source's dust event timeline, so the capability can refuse it while anything remains unread.
 *
 *   There is deliberately no "the source provably holds no dust event" arm, which is where this departs from its shielded
 *   twin. Shielded can settle that from the tip alone: a commitment tree that has never grown cannot have had a
 *   nullifier spent against it either, so `zswapEndIndex === 0` proves the timeline is empty. Dust has no such witness
 *   — a `ParamChange` is a dust ledger event and moves neither the commitment tree nor the generation tree, so both end
 *   indices at zero prove nothing. A chain holding literally no dust event therefore never produces a signal; it
 *   crosses on its first dust event instead. That is a liveness cost on a chain nobody has used, not a correctness one,
 *   and it is preferred to a shortcut that cannot be justified.
 */
export type VersionSignalSyncUpdate = Readonly<{
  _tag: 'VersionSignal';
  /** The protocol version the source's tip was reported under. */
  version: number;
  /** The highest dust event id the source holds. */
  highestEventId: number;
}>;
export const VersionSignalSyncUpdate = {
  create: (version: number, highestEventId: number): VersionSignalSyncUpdate => {
    return {
      _tag: 'VersionSignal',
      version,
      highestEventId,
    };
  },
};

/**
 * What the indexer-backed sync source emits.
 *
 * @remarks
 *   Ordinarily a batch of dust events; and, on a timer, what the chain says about its own version when its timeline says
 *   nothing.
 */
export type WalletSyncUpdate = EventsWalletSyncUpdate | VersionSignalSyncUpdate;
export const WalletSyncUpdate = {
  create: (updates: WalletSyncSubscription[], secretKey: DustSecretKey, timestamp: Date): EventsWalletSyncUpdate => {
    return {
      _tag: 'Events',
      updates,
      secretKey,
      timestamp,
    };
  },
};

/** How often the chain is asked its version when the configuration does not say. */
const DEFAULT_VERSION_WATCH_INTERVAL_MS = 30_000;

/**
 * How long one event-id probe is given to produce its single answer.
 *
 * @remarks
 *   Both a stall guard and, on a chain with no dust history at all, the ordinary way the tick ends. A wallet with a
 *   cursor subscribes at an event that provably exists, so there the answer arrives at once or the transport is broken;
 *   a wallet on a chain that has never produced a dust event subscribes to a timeline the indexer will keep open and
 *   never write to. Without a bound, either would leave the poll loop parked on a tick that never completes and the
 *   wallet would stop asking altogether. A bound turns both into a skipped tick.
 */
const EVENT_TIP_PROBE_TIMEOUT = Duration.seconds(10);

/**
 * Asks the source how far its dust event timeline goes.
 *
 * @remarks
 *   Over the event subscription rather than a query, because the schema has no query that reaches a dust ledger event:
 *   `block`/`transactions` reach one only through a block that happens to contain dust events, which on a quiet chain
 *   is precisely the block that does not. `maxId` is a property of the whole dust timeline — the indexer computes it as
 *   the maximum id within the dust grouping — so any single event answers it: the first one delivered is taken and the
 *   subscription closed.
 *
 *   The cursor is the wallet's own. The event it last applied provably exists, so the source answers immediately and has
 *   the least backfill to abandon; a wallet that has applied nothing asks from the start, where the first event is —
 *   or, on a chain with no dust event at all, where nothing is, and the tick times out into silence.
 * @param config The sync configuration, carrying the keep-alive the source's subscriptions use.
 * @param resumeFrom The wallet's cursor; below zero means "from the very start".
 * @returns The highest dust event id, or nothing if the source did not answer.
 */
const highestEventId = (config: DefaultSyncConfiguration, resumeFrom: bigint) =>
  pipe(
    DustLedgerEventTip.run({ id: resumeFrom < 0n ? null : Number(resumeFrom) }),
    Stream.runHead,
    Effect.map(Option.map((answer) => answer.dustLedgerEvents.maxId)),
    Effect.scoped,
    Effect.timeout(EVENT_TIP_PROBE_TIMEOUT),
  );

/**
 * One check of the chain's protocol version, gated on the wallet being caught up on the source's dust event ids.
 *
 * @remarks
 *   The order of the two questions is load-bearing. The tip is read **first**: a tip reported at a version means the
 *   source has indexed through the block that carries it, so every event below it is already counted in the `maxId`
 *   read afterwards. Asked the other way round, an event indexed between the two answers could be one of the version
 *   that preceded the tip — unread, uncounted, and exactly what the gate exists to catch.
 *
 *   The one short-circuit is an answer rather than a shortcut: a tip at or below the version the wallet already held is a
 *   signal that could only be a no-op, so no probe is opened and nothing is emitted — which is what keeps a settled
 *   wallet from polling a subscription for the rest of its life. There is deliberately no second short-circuit for a
 *   chain that provably holds no dust event, because no such proof is available from the tip; see
 *   {@link VersionSignalSyncUpdate}.
 *
 *   Everything else is swallowed. A tick that fails says nothing about the chain, so it must neither reach the state nor
 *   take the sync stream down with it; the next tick is the retry, and costs nothing to wait for.
 * @param config The sync configuration, for the indexer to ask.
 * @param resumeFrom The wallet's cursor, for the probe.
 * @param knownVersion The version the wallet already held when this stream opened — a lower bound on what it holds now.
 * @returns The signal, or nothing when there is nothing to say or nobody said it.
 */
const readVersionSignal = (
  config: DefaultSyncConfiguration,
  resumeFrom: bigint,
  knownVersion: ProtocolVersion.ProtocolVersion,
): Effect.Effect<Option.Option<VersionSignalSyncUpdate>, never, SubscriptionClient> =>
  pipe(
    BlockHash.run({ offset: null }),
    Effect.provide(HttpQueryClient.layer({ url: config.indexerClientConnection.indexerHttpUrl })),
    Effect.scoped,
    Effect.flatMap((answer) =>
      Option.match(Option.fromNullable(answer.block), {
        onNone: () => Effect.succeedNone,
        onSome: (tip) =>
          BigInt(tip.protocolVersion) <= knownVersion
            ? Effect.succeedNone
            : pipe(
                highestEventId(config, resumeFrom),
                Effect.map(Option.map((maxId) => VersionSignalSyncUpdate.create(tip.protocolVersion, maxId))),
              ),
      }),
    ),
    Effect.catchAll(() => Effect.succeedNone),
  );

/**
 * The chain's version, re-asked on a timer for as long as sync runs.
 *
 * @remarks
 *   Deliberately silent about ticks that say nothing: a tick that finds the chain where the wallet left it, or that
 *   cannot reach the chain at all, emits no element rather than an empty one, so nothing downstream has to know that
 *   polling is how the answer was arrived at.
 * @param config The sync configuration, carrying the interval.
 * @param resumeFrom The wallet's cursor, for the probe.
 * @param knownVersion The version the wallet held when this stream opened.
 * @returns The signals, or an empty stream when watching is turned off.
 */
const versionWatch = (
  config: DefaultSyncConfiguration,
  resumeFrom: bigint,
  knownVersion: ProtocolVersion.ProtocolVersion,
): Stream.Stream<VersionSignalSyncUpdate, never, SubscriptionClient> => {
  const intervalMs = config.versionWatch?.intervalMs ?? DEFAULT_VERSION_WATCH_INTERVAL_MS;

  return intervalMs <= 0
    ? Stream.empty
    : pipe(
        Stream.fromSchedule(Schedule.spaced(Duration.millis(intervalMs))),
        Stream.mapEffect(() => readVersionSignal(config, resumeFrom, knownVersion)),
        Stream.filterMap(identity),
      );
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

      const timeline = pipe(
        indexerSyncService.subscribeWallet(state),
        Stream.groupedWithin(batchSize, batchTimeout),
        Stream.map(Chunk.toArray),
        Stream.map((data) => WalletSyncUpdate.create(data, secretKey, new Date())),
        batchSpacing > 0
          ? Stream.schedule(Schedule.spaced(Duration.millis(batchSpacing)))
          : (eventsStream) => eventsStream,
      );

      // The same cursor `subscribeWallet` resumes from: the source's cursor is inclusive, so the probe re-asks at the
      // last event this wallet applied — one it provably holds — rather than one past it.
      const resumeFrom = state.progress.appliedIndex - 1n;

      // The timeline is what the source is for, so it decides when the source is done: `haltStrategy: 'left'` stops the
      // watcher with it rather than leaving a poll loop running against a stream nobody is reading. It has nothing to
      // say about failure — a failing timeline still fails the merged stream, where the variant's retry can see it.
      return pipe(
        Stream.merge(timeline, versionWatch(config, resumeFrom, state.protocolVersion), { haltStrategy: 'left' }),
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

/** The result of an update that observed nothing of the chain. */
const noChanges = (state: CoreWallet): ChangesResult => ({
  changes: [],
  protocolVersion: Number(state.protocolVersion),
});

/**
 * Folds what the chain said about its own version into the wallet state.
 *
 * @remarks
 *   The same recording the event path makes through {@link annotateVersion}, and nothing else: no cursor moves, no dust
 *   changes hands, no tree grows. A signal is an observation about the chain, not a piece of it.
 *
 *   One situation makes the observation unsafe to record, and it leaves the state exactly as it was: unread events below
 *   the source's tip mean the hand-over would park the cursor in front of history the next variant cannot read — and
 *   those events carry the version themselves, so nothing is lost by waiting for them. That is not an error: the next
 *   tick asks again.
 *
 *   A version at or below the one already recorded needs no guard of its own — {@link annotateVersion} never goes
 *   backwards — so a source briefly answering from a lagging replica cannot drag a wallet back over a boundary.
 * @param state The wallet to record on.
 * @param update What the chain said, and how far its dust event timeline goes.
 * @returns The wallet, annotated or untouched, and an empty result.
 */
const applyVersionSignal = (state: CoreWallet, update: VersionSignalSyncUpdate): [CoreWallet, ChangesResult] => [
  BigInt(update.highestEventId) > state.progress.appliedIndex
    ? state
    : annotateVersion(state, Option.some(ProtocolVersion.ProtocolVersion(BigInt(update.version)))),
  noChanges(state),
];

export const makeDefaultSyncCapability = (): SyncCapability<CoreWallet, WalletSyncUpdate, ChangesResult> => {
  return {
    applyUpdate(
      state: CoreWallet,
      wrappedUpdate: WalletSyncUpdate,
      activeRange: ProtocolVersion.ProtocolVersion.Range,
    ): [CoreWallet, ChangesResult] {
      if (wrappedUpdate._tag === 'VersionSignal') {
        return applyVersionSignal(state, wrappedUpdate);
      }

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
