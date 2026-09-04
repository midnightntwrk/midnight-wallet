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
import {
  Chunk,
  Duration,
  Effect,
  Either,
  identity,
  Option,
  ParseResult,
  pipe,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from 'effect';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { CoreWallet } from './CoreWallet.js';
import { V8 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { BlockHash, ZswapEventTip, ZswapEvents } from '@midnightntwrk/wallet-sdk-indexer-client';
import {
  ConnectionHelper,
  HttpQueryClient,
  WsSubscriptionClient,
} from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { SyncWalletError, type WalletError } from './WalletError.js';
import { WsURL } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { type TransactionHistoryService } from './TransactionHistory.js';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';

export interface SyncService<TState, TStartAux, TUpdate> {
  updates: (state: TState, auxData: TStartAux) => Stream.Stream<TUpdate, WalletError, Scope.Scope>;
}

export type ChangesResult = {
  readonly changes: ledger.ZswapStateChanges[];
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
   * signal that triggers migration — otherwise the last applied item's version. `None` for an empty batch.
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
 *   This is the one place the boundary rule lives; both the indexer capability (per event) and the simulator capability
 *   (per block) go through it, so they cannot drift apart.
 * @param items The batch, in source order.
 * @param versionOf Reads the protocol version an item was reported at.
 * @param activeRange The variant's half-open activation range.
 * @returns The applied/deferred split and the version to record.
 */
export const splitAtVersionBoundary = <T>(
  items: readonly T[],
  versionOf: (item: T) => number,
  activeRange: ProtocolVersion.ProtocolVersion.Range,
): BoundarySplit<T> => {
  const [, end] = activeRange;
  const boundary = items.findIndex((item) => BigInt(versionOf(item)) >= end);
  const [applied, deferred] =
    boundary < 0 ? [items, [] as readonly T[]] : [items.slice(0, boundary), items.slice(boundary)];
  const signalling = deferred.at(0) ?? applied.at(-1);

  return {
    applied,
    deferred,
    observedVersion:
      signalling === undefined
        ? Option.none()
        : Option.some(ProtocolVersion.ProtocolVersion(BigInt(versionOf(signalling)))),
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
 *   wallet therefore observes the chain's protocol version only through events, and on a chain that crosses a protocol
 *   boundary and then produces no shielded traffic it observes no version at all — it stays on the variant it was
 *   running, and everything built through it stays routed to that variant's ledger. Asking on a timer is what closes
 *   that, and the cost of asking is one small query per interval on a chain that has not moved.
 *
 *   This variant is the pre-fork one, so it is the one that actually crosses: a wallet stranded here is a wallet still
 *   building transactions for a ledger version the chain has left behind.
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
  batchUpdates?: BatchUpdatesConfig;
  versionWatch?: VersionWatchConfig;
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

/** The ordinary arm of {@link WalletSyncUpdate}: a batch of the indexer's event timeline, still encoded. */
export type EventsWalletSyncUpdate = {
  _tag: 'Events';
  updates: EventsSyncUpdate[];
  secretKeys: ledger.ZswapSecretKeys;
};

/**
 * What the chain says about itself when its timeline says nothing.
 *
 * @remarks
 *   An observation, not a piece of the chain: it moves no cursor, inserts nothing and produces no changes. All it can do
 *   is record a protocol version, which is enough, because recording one outside the running variant's activation range
 *   is exactly what makes the runtime hand over.
 *
 *   `highestEventId` is what makes the record safe to make. Handing over parks the sync cursor where it stands, and the
 *   variant that takes over re-fetches from there — so an event still unread below the source's tip would reach it as
 *   bytes of the version that preceded it, which its ledger cannot deserialize, and which may in any case be carrying a
 *   coin that would then never reach the far side. The signal therefore travels with the far end of the source's event
 *   timeline, so the capability can refuse it while anything remains unread. `null` means the source provably holds no
 *   zswap event at all, which is the one case where nothing can be unread.
 */
export type VersionSignalSyncUpdate = Readonly<{
  _tag: 'VersionSignal';
  /** The protocol version the source's tip was reported under. */
  version: number;
  /** The highest event id the source holds, or `null` when it provably holds no event. */
  highestEventId: number | null;
}>;
export const VersionSignalSyncUpdate = {
  create: (version: number, highestEventId: number | null): VersionSignalSyncUpdate => {
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
 *   Ordinarily a batch of events; and, on a timer, what the chain says about its own version when its timeline says
 *   nothing.
 */
export type WalletSyncUpdate = EventsWalletSyncUpdate | VersionSignalSyncUpdate;
export const WalletSyncUpdate = {
  create: (updates: EventsSyncUpdate[], secretKeys: ledger.ZswapSecretKeys): EventsWalletSyncUpdate => {
    return {
      _tag: 'Events',
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

/**
 * One event of the source's timeline, still encoded.
 *
 * @remarks
 *   The event is carried as the source served it rather than as a `ledger.Event`, because whether this ledger version may
 *   read it at all is not the source's question to answer. A batch spanning a protocol boundary carries events of the
 *   version that follows this one, which this ledger version cannot deserialize — the serialization header names a
 *   different version — and after a hand-over the inclusive cursor re-delivers an event of the version that preceded
 *   it, which it equally cannot. Both are ordinary, and neither is an error: they belong to the variant either side.
 *
 *   So the bytes travel undecoded and only the capability, which knows the activation range, reads the ones it is about
 *   to apply — see {@link readEvent}. Decoding here would fail the whole batch on an event nobody intended to apply.
 */
export const EventsSyncUpdate = Schema.TaggedStruct('EventsSyncUpdate', {
  id: Schema.Number,
  protocolVersion: Schema.Number,
  maxId: Schema.Number,
  raw: Schema.String,
});

export type EventsSyncUpdate = Schema.Schema.Type<typeof EventsSyncUpdate>;

const EventsSyncUpdateFromPayload = Schema.transform(EventsSyncUpdatePayload, EventsSyncUpdate, {
  strict: true,
  decode: (input) => ({
    _tag: 'EventsSyncUpdate' as const,
    id: input.id,
    protocolVersion: input.protocolVersion,
    maxId: input.maxId,
    raw: input.raw,
  }),
  encode: (update) => ({
    id: update.id,
    raw: update.raw,
    protocolVersion: update.protocolVersion,
    maxId: update.maxId,
  }),
});

/**
 * Reads an event this variant is going to apply.
 *
 * @remarks
 *   The counterpart of {@link EventsSyncUpdate} carrying its event encoded: a capability calls this on the batch prefix it
 *   owns, and never on what it defers. Failure here is a genuine one — an event this variant claimed and cannot read —
 *   and is raised rather than returned, because `SyncCapability.applyUpdate` is total in its own domain and the variant
 *   already turns a throw from it into a typed synchronization error.
 * @param update The update to read.
 * @returns The event it carries.
 * @throws ParseError if the bytes are not an event this ledger version can deserialize.
 */
export const readEvent = (update: EventsSyncUpdate): ledger.Event => Schema.decodeSync(HexedLedgerEvent)(update.raw);

/** How often the chain is asked its version when the configuration does not say. */
const DEFAULT_VERSION_WATCH_INTERVAL_MS = 30_000;

/**
 * How long one event-id probe is given to produce its single answer.
 *
 * @remarks
 *   Only a stall guard. The probe subscribes at a cursor whose event provably exists, so the answer arrives at once or
 *   the transport is broken; without a bound, a half-open socket would leave the poll loop parked on a tick that never
 *   completes and the wallet would stop asking altogether. A bound turns that into a skipped tick.
 */
const EVENT_TIP_PROBE_TIMEOUT = Duration.seconds(10);

/**
 * Asks the source how far its zswap event timeline goes.
 *
 * @remarks
 *   Over the event subscription rather than a query, because the schema has no query that reaches a zswap ledger event:
 *   `block`/`transactions` reach one only through a block that happens to contain zswap events, which on a quiet chain
 *   is precisely the block that does not. `maxId` is a property of the whole timeline, so any single event answers it —
 *   the first one delivered is taken and the subscription closed.
 *
 *   The cursor is the wallet's own. The event it last applied provably exists, so the source answers immediately and has
 *   the least backfill to abandon; a wallet that has applied nothing asks from the start, where the first event is.
 * @param config The sync configuration, for the keep-alive the source's subscriptions use.
 * @param url Where to subscribe.
 * @param resumeFrom The wallet's cursor; below zero means "from the very start".
 * @returns The highest event id, or nothing if the source did not answer.
 */
const highestEventId = (config: DefaultSyncConfiguration, url: URL | string, resumeFrom: bigint) =>
  pipe(
    ZswapEventTip.run({ id: resumeFrom < 0n ? null : Number(resumeFrom) }),
    Stream.runHead,
    Effect.map(Option.map((answer) => answer.zswapLedgerEvents.maxId)),
    Effect.provide(WsSubscriptionClient.layer({ url, keepAlive: config.indexerClientConnection.keepAlive })),
    Effect.scoped,
    Effect.timeout(EVENT_TIP_PROBE_TIMEOUT),
  );

/**
 * One check of the chain's protocol version, gated on the wallet being caught up on the source's event ids.
 *
 * @remarks
 *   The order of the two questions is load-bearing. The tip is read **first**: a tip reported at a version means the
 *   source has indexed through the block that carries it, so every event below it is already counted in the `maxId`
 *   read afterwards. Asked the other way round, an event indexed between the two answers could be one of the version
 *   that preceded the tip — unread, uncounted, and exactly what the gate exists to catch.
 *
 *   Two short-circuits, both of them answers rather than shortcuts. A tip at or below the version the wallet already held
 *   is a signal that could only be a no-op, so no probe is opened and nothing is emitted — which is what keeps a
 *   settled wallet from polling a subscription for the rest of its life. And a tip whose commitment tree has never
 *   grown cannot have had a nullifier spent against it either, so such a chain provably holds no zswap event: nothing
 *   can be unread, and the signal goes out with `null`.
 *
 *   Everything else is swallowed. A tick that fails says nothing about the chain, so it must neither reach the state nor
 *   take the sync stream down with it; the next tick is the retry, and costs nothing to wait for.
 * @param config The sync configuration, for the indexer to ask.
 * @param url Where to run the event-id probe.
 * @param resumeFrom The wallet's cursor, for the probe.
 * @param knownVersion The version the wallet already held when this stream opened — a lower bound on what it holds now.
 * @returns The signal, or nothing when there is nothing to say or nobody said it.
 */
const readVersionSignal = (
  config: DefaultSyncConfiguration,
  url: URL | string,
  resumeFrom: bigint,
  knownVersion: ProtocolVersion.ProtocolVersion,
): Effect.Effect<Option.Option<VersionSignalSyncUpdate>> =>
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
            : tip.zswapEndIndex === 0
              ? Effect.succeedSome(VersionSignalSyncUpdate.create(tip.protocolVersion, null))
              : pipe(
                  highestEventId(config, url, resumeFrom),
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
 * @param url Where to run the event-id probe.
 * @param resumeFrom The wallet's cursor, for the probe.
 * @param knownVersion The version the wallet held when this stream opened.
 * @returns The signals, or an empty stream when watching is turned off.
 */
const versionWatch = (
  config: DefaultSyncConfiguration,
  url: URL | string,
  resumeFrom: bigint,
  knownVersion: ProtocolVersion.ProtocolVersion,
): Stream.Stream<VersionSignalSyncUpdate> => {
  const intervalMs = config.versionWatch?.intervalMs ?? DEFAULT_VERSION_WATCH_INTERVAL_MS;

  return intervalMs <= 0
    ? Stream.empty
    : pipe(
        Stream.fromSchedule(Schedule.spaced(Duration.millis(intervalMs))),
        Stream.mapEffect(() => readVersionSignal(config, url, resumeFrom, knownVersion)),
        Stream.filterMap(identity),
      );
};

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

      const timeline =
        batchSpacing > 0 ? Stream.schedule(eventsStream, Schedule.spaced(Duration.millis(batchSpacing))) : eventsStream;

      // The timeline is what the source is for, so it decides when the source is done: `haltStrategy: 'left'` stops the
      // watcher with it rather than leaving a poll loop running against a stream nobody is reading. It has nothing to
      // say about failure — a failing timeline still fails the merged stream, where the variant's retry can see it.
      return Stream.merge(timeline, versionWatch(config, indexerWsUrl, resumeFrom, state.protocolVersion), {
        haltStrategy: 'left',
      });
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
 *   The same recording the event path makes through {@link annotateVersion}, and nothing else: no cursor moves, no coin
 *   changes hands, no tree grows. A signal is an observation about the chain, not a piece of it.
 *
 *   Unread events below the source's tip make the observation unsafe to record, and leave the state exactly as it was:
 *   the hand-over would park the cursor in front of history the next variant cannot read — and those events carry the
 *   version themselves, so nothing is lost by waiting for them. That is not an error; the next tick asks again.
 *
 *   A version at or below the one already recorded needs no guard of its own — {@link annotateVersion} never goes
 *   backwards — so a source briefly answering from a lagging replica cannot drag a wallet back over a boundary.
 * @param state The wallet to record on.
 * @param update What the chain said, and how far its event timeline goes.
 * @returns The wallet, annotated or untouched, and an empty result.
 */
const applyVersionSignal = (state: CoreWallet, update: VersionSignalSyncUpdate): [CoreWallet, ChangesResult] => {
  const appliedIndex = state.progress?.appliedIndex ?? 0n;
  const unreadEvents = update.highestEventId !== null && BigInt(update.highestEventId) > appliedIndex;

  return [
    unreadEvents ? state : annotateVersion(state, Option.some(ProtocolVersion.ProtocolVersion(BigInt(update.version)))),
    noChanges(state),
  ];
};

export const makeEventsSyncCapability = (): SyncCapability<CoreWallet, WalletSyncUpdate, ChangesResult> => {
  return {
    applyUpdate: (
      state: CoreWallet,
      wrappedUpdate: WalletSyncUpdate,
      activeRange: ProtocolVersion.ProtocolVersion.Range,
    ): [CoreWallet, ChangesResult] => {
      if (wrappedUpdate._tag === 'VersionSignal') {
        return applyVersionSignal(state, wrappedUpdate);
      }

      if (wrappedUpdate.updates.length === 0) {
        return [state, noChanges(state)];
      }

      // The subscription resumes at the last-applied index and its cursor is inclusive, so the
      // boundary event (id === appliedIndex) is re-delivered. Replaying it would re-insert
      // commitments already in the zswap state ("non-linear insertion" error), so only events
      // strictly after the applied index are replayed. The boundary is still used (below) to
      // refresh the tip and mark the wallet connected — that is how an already-caught-up wallet
      // learns it is synced when no new events exist.
      const appliedIndex = state.progress?.appliedIndex ?? 0n;
      const freshUpdates = wrappedUpdate.updates.filter((u) => BigInt(u.id) > appliedIndex);

      // The tip is a property of the source, not of what this variant chose to apply, so it is read from
      // the batch tail even when the tail belongs to the next protocol version.
      const lastUpdate = wrappedUpdate.updates.at(-1)!;
      const highestRelevantWalletIndex = BigInt(lastUpdate.maxId);

      const { applied, observedVersion } = splitAtVersionBoundary(
        freshUpdates,
        (update) => update.protocolVersion,
        activeRange,
      );

      // Read here and nowhere earlier: `applied` is exactly the slice this variant owns, so nothing outside its
      // activation range — nor anything below its cursor — is ever handed to this ledger version's deserializer.
      const [newState, newChanges]: [CoreWallet, ledger.ZswapStateChanges[]] =
        applied.length === 0
          ? [state, []]
          : CoreWallet.replayEventsWithChanges(state, wrappedUpdate.secretKeys, applied.map(readEvent));

      // `appliedIndex` stops at the last event this variant actually replayed. The next variant resumes one
      // below it on an inclusive cursor, so the deferred suffix is re-fetched rather than skipped.
      const updatedState = CoreWallet.updateProgress(annotateVersion(newState, observedVersion), {
        highestRelevantWalletIndex,
        appliedIndex: applied.length === 0 ? appliedIndex : BigInt(applied.at(-1)!.id),
        isConnected: true,
      });

      return [
        updatedState,
        {
          changes: newChanges,
          // Tags the changes that were actually produced, so tx-history records the version they were applied
          // under rather than the one that is about to trigger the hand-over.
          protocolVersion: applied.at(-1)?.protocolVersion ?? Number(state.protocolVersion),
        },
      ];
    },
  };
};

export type SimulatorSyncConfiguration = {
  simulator: V8.Simulator;
};

export type SimulatorSyncUpdate = {
  update: V8.SimulatorState;
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
        Stream.map((state) => ({ update: state, secretKeys })),
      );
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
      const { update: simulatorState, secretKeys } = update;
      const lastBlock = V8.getLastBlock(simulatorState);
      if (lastBlock === undefined) {
        return [state, { changes: [], protocolVersion: Number(state.protocolVersion) }];
      }

      // appliedIndex semantics: the first block number we haven't processed yet.
      // Initial: appliedIndex = 0 (haven't processed any blocks)
      // After processing block N: appliedIndex = N + 1 (next block to process)
      //
      // The boundary is applied at block granularity here — a block carries exactly one protocol version,
      // stamped when it was produced — but it is the same rule and the same helper the indexer path uses.
      const pending = simulatorState.blocks.filter((block) => block.number >= state.progress.appliedIndex);
      const { applied, observedVersion } = splitAtVersionBoundary(
        pending,
        (block) => Number(block.protocolVersion),
        activeRange,
      );

      const events = applied.flatMap((block) => block.transactions.flatMap((tx) => tx.result.events));

      const [newState, newChanges]: [CoreWallet, ledger.ZswapStateChanges[]] =
        applied.length === 0 ? [state, []] : CoreWallet.replayEventsWithChanges(state, secretKeys, events);

      const lastAppliedBlock = applied.at(-1);
      return [
        CoreWallet.updateProgress(annotateVersion(newState, observedVersion), {
          appliedIndex: lastAppliedBlock === undefined ? state.progress.appliedIndex : lastAppliedBlock.number + 1n,
        }),
        {
          changes: newChanges,
          protocolVersion:
            lastAppliedBlock === undefined ? Number(state.protocolVersion) : Number(lastAppliedBlock.protocolVersion),
        },
      ];
    },
  };
};
