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
  Array as Arr,
  Effect,
  Either,
  HashMap,
  HashSet,
  Layer,
  Option,
  pipe,
  Schema,
  type Scope,
  Stream,
  Duration,
  Chunk,
  Schedule,
  identity,
} from 'effect';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type LedgerParametersCodec } from '@midnightntwrk/wallet-sdk-capabilities/codecs';
import {
  dustNullifier,
  successorDustUtxo,
  type DustNullifier,
  type DustSecretKey,
  DustStateChanges,
  type DustLocalState,
  type LedgerParameters,
} from '@midnightntwrk/ledger-v9';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import {
  DustGenerationEvents,
  BlockHash,
  DustLedgerEventTip,
  DustLedgerEvents,
  DustNullifierTransactions,
  DustCommitmentMerkleTreeUpdate,
} from '@midnightntwrk/wallet-sdk-indexer-client';
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
import { type Simulator, type SimulatorState, getLastBlock } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { CoreWallet } from './CoreWallet.js';
import { type NetworkId } from './types/ledger.js';
import {
  type CollapsedMerkleTree,
  CollapsedMerkleTreeSchema,
  type DustGenerationsSubscription,
  DustGenerationsSubscriptionSchema,
  DustGenerationsSyncUpdate,
  type DustNullifierTransactionsSubscription,
  DustNullifierTransactionSubscriptionSchema,
  type DustProjectionsUpdate,
  type DustSpendProcessedEvent,
  type DustUtxoUpdate,
  DustUtxoMap,
  SyncEventsUpdateSchema,
  VersionSignalSyncUpdate,
  type WalletSyncSubscription,
  WalletSyncUpdate,
  defaultLedgerParametersCodecs,
  makeBlockDataSchema,
  type BlockData,
  type DustGenerationDtimUpdate,
  type NullifierRegularTransaction,
  ProgressUpdate,
  StateUpdate,
  isProgressUpdate,
  readEvent,
  readNullifierBlockParameters,
  tryReadEvent,
} from './SyncSchema.js';
import {
  bigintToLeHex,
  calculatePrefixLength,
  gapRanges,
  hashMapGroupBy,
  leBigintToHex,
  uniqueArray,
} from './Utils.js';
import { type Dust } from './types/index.js';

export interface SyncService<TState, TStartAux, TUpdate> {
  updates: (state: TState, auxData: TStartAux) => Stream.Stream<TUpdate, WalletError, Scope.Scope>;
  blockData: (height?: number) => Effect.Effect<BlockData, WalletError>;
}

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
  anonymityLevel?: number;
  versionWatch?: VersionWatchConfig;
  /** The ledger parameters codecs blocks are read with; defaults to {@link defaultLedgerParametersCodecs}. */
  ledgerParametersCodecs?: LedgerParametersCodec.LedgerParametersCodecs<LedgerParameters>;
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

    blockData: (height?: number): Effect.Effect<BlockData, WalletError> => {
      return pipe(
        indexerSyncService.blockData(height),
        Effect.provide(indexerSyncService.queryClient()),
        Effect.scoped,
      );
    },
  };
};

// map provided utxos by nullifier putting them into 2 separate maps (spent and unspent)
const accumulateUtxoUpdates = (
  updates: DustUtxoUpdate[],
  initialUtxos: DustUtxoMap,
  initialSpentUtxos: DustUtxoMap,
): { nextUtxos: DustUtxoMap; nextSpentUtxos: DustUtxoMap } =>
  updates.reduce(
    ({ nextUtxos, nextSpentUtxos }, update) => {
      const entry = {
        qdo: update.qdo,
        transactionId: update.transactionId,
        transactionHash: update.transactionHash,
        genInfo: update.genInfo,
      };
      return update.isSpent
        ? { nextUtxos, nextSpentUtxos: HashMap.set(nextSpentUtxos, update.dustNullifier, entry) }
        : { nextUtxos: HashMap.set(nextUtxos, update.dustNullifier, entry), nextSpentUtxos };
    },
    { nextUtxos: initialUtxos, nextSpentUtxos: initialSpentUtxos },
  );

const loadCollapsedCommitments = (
  lastAppliedIndex: number,
  maxIndex: number,
  newUtxos: Readonly<DustUtxoMap>,
  indexerSyncService: IndexerSyncService,
): Effect.Effect<CollapsedMerkleTree[], WalletError, Scope.Scope | QueryClient> => {
  if (maxIndex < 0 || lastAppliedIndex === maxIndex) {
    return Effect.succeed([]);
  }

  const skipMtIndexes = [...newUtxos]
    .toSorted((a, b) => Number(a[1].qdo.mtIndex - b[1].qdo.mtIndex))
    .map(([_, u]) => Number(u.qdo.mtIndex)); // e.g. 43, 67, 68, 75

  // 1: split into the ranges not covered by the wallet's own utxo indexes
  const groups = gapRanges(lastAppliedIndex, maxIndex, skipMtIndexes);

  // 2: query all groups
  return pipe(
    groups.map(({ start, end }) => indexerSyncService.dustCommitmentMerkleTreeUpdate(start, end)),
    Effect.all,
  );
};

const NULLIFIER_BYTE_LENGTH = 32;
const NULLIFIER_LENGTH = NULLIFIER_BYTE_LENGTH * 2;

// Progress through the nullifier-resolution phase, in commitment-index units: a nullifier with no further spends
// counts as a full scan of the commitment space; a still-live chain counts up to the merkle index of its freshest
// successor. Bounded by totalNullifiers * maxCommitmentEndIndex (the phase ceiling).
export const nullifierPhaseProgress = (
  mtIndicesSum: bigint,
  totalNullifiers: number,
  freshCount: number,
  maxCommitmentEndIndex: number,
): number =>
  Math.min(
    Number(mtIndicesSum) + (totalNullifiers - freshCount) * maxCommitmentEndIndex,
    totalNullifiers * maxCommitmentEndIndex,
  );

const resolveNullifierSpends = (
  initialNullifiers: DustNullifier[],
  initialNewUtxos: DustUtxoMap,
  pendingDust: Map<DustNullifier, Dust>,
  dustState: DustLocalState,
  secretKey: DustSecretKey,
  latestBlock: BlockData,
  dustGenerationUpdates: DustGenerationsSyncUpdate,
  indexerSyncService: IndexerSyncService,
  anonymityLevel: number,
  ledgerParametersCodecs: LedgerParametersCodec.LedgerParametersCodecs<LedgerParameters>,
  emit: {
    single: (update: DustProjectionsUpdate) => Promise<void>;
  },
): Effect.Effect<
  { nextUtxos: DustUtxoMap; nextSpentUtxos: DustUtxoMap },
  WalletError,
  Scope.Scope | SubscriptionClient
> => {
  const maxCommitmentEndIndex = latestBlock.dustCommitmentEndIndex - 1;
  const initialSpentUtxos: DustUtxoMap = HashMap.empty();
  return pipe(
    Stream.unfoldEffect(
      [initialNullifiers, initialNewUtxos, initialSpentUtxos] as const,
      ([nullifiersToCheck, newUtxos, spentUtxos]) => {
        if (nullifiersToCheck.length === 0) {
          return Effect.succeed(Option.none());
        }
        return Effect.gen(function* () {
          const prefixLength = calculatePrefixLength(anonymityLevel, maxCommitmentEndIndex, NULLIFIER_LENGTH);
          const nullifierTransactions = yield* pipe(
            indexerSyncService.subscribeDustNullifierTransactions(
              nullifiersToCheck as Arr.NonEmptyArray<DustNullifier>,
              latestBlock.height,
              prefixLength,
            ),
            Stream.runCollect,
            Effect.map(Chunk.toArray),
          );

          const dustUtxoUpdates = yield* createDustUtxoUpdates(
            dustState,
            matchedDustSpends(nullifierTransactions),
            secretKey,
            newUtxos,
            pendingDust,
            dustGenerationUpdates.generationDtimeUpdates,
            ledgerParametersCodecs,
          );

          // report progress
          const freshUtxos = dustUtxoUpdates.filter((u) => !u.isSpent);
          if (freshUtxos.length > 0) {
            const mtIndicesSum = freshUtxos.reduce((partialSum, a) => partialSum + a.qdo.mtIndex, 0n);
            const generationEndIndex = latestBlock.dustGenerationEndIndex - 1;
            const progress = nullifierPhaseProgress(
              mtIndicesSum,
              initialNullifiers.length,
              freshUtxos.length,
              maxCommitmentEndIndex,
            );

            // NOTE: since this process goes after the generation updates, we need to add the generationEndIndex to the progress
            yield* Effect.promise(() => emit.single(ProgressUpdate({ appliedIndex: progress + generationEndIndex })));
          }

          const { nextUtxos, nextSpentUtxos } = accumulateUtxoUpdates(dustUtxoUpdates, newUtxos, spentUtxos);
          const nextNullifiersToCheck = dustUtxoUpdates.filter((u) => !u.isSpent).map((u) => u.dustNullifier);
          return Option.some([
            { nextUtxos, nextSpentUtxos },
            [nextNullifiersToCheck, nextUtxos, nextSpentUtxos] as const,
          ]);
        });
      },
    ),
    Stream.runCollect,
    Effect.map(Chunk.toArray),
    Effect.map((results) =>
      pipe(
        Arr.last(results),
        Option.getOrElse(() => ({ nextUtxos: initialNewUtxos, nextSpentUtxos: HashMap.empty() })),
      ),
    ),
  );
};

export const doEventlessSync = (
  state: CoreWallet,
  secretKey: DustSecretKey,
  anonymityLevel: number,
  indexerSyncService: IndexerSyncService,
  ledgerParametersCodecs: LedgerParametersCodec.LedgerParametersCodecs<LedgerParameters> = defaultLedgerParametersCodecs,
): Stream.Stream<DustProjectionsUpdate, WalletError, Scope.Scope | QueryClient | SubscriptionClient> => {
  return Stream.asyncEffect((emit) =>
    Effect.gen(function* () {
      const latestBlock = yield* indexerSyncService.blockData();
      const maxCommitmentTreeIndex = latestBlock.dustCommitmentEndIndex - 1;
      const maxGeneratingTreeIndex = latestBlock.dustGenerationEndIndex - 1;
      const lastSyncedCommitmentIndex = state.state.commitmentTreeFirstFree - 1n;
      const lastSyncedGenerationIndex = state.state.generatingTreeFirstFree - 1n;
      const lastSyncedBlockHeight = state.progress.highestIndex;

      const highestInitialIndex =
        maxGeneratingTreeIndex + maxCommitmentTreeIndex + state.state.nullifiers.size * maxCommitmentTreeIndex;
      const initialAppliedIndex =
        Number(lastSyncedGenerationIndex) +
        Number(lastSyncedCommitmentIndex) +
        state.state.nullifiers.size * Number(maxCommitmentTreeIndex);

      // What this pass resumed from, in one line. A projections pass is a single snapshot fetch, so when it comes back
      // with less than expected the only question worth asking is where it started — and the three cursors that decide
      // that are otherwise invisible to anything outside this function, including to a wallet that arrived here by
      // migration and is running its first pass on the far side of a fork.
      yield* Effect.logDebug(
        `Projections sync resuming from block height ${lastSyncedBlockHeight}, generation index` +
          ` ${lastSyncedGenerationIndex}, commitment index ${lastSyncedCommitmentIndex}; chain at block` +
          ` ${latestBlock.height} with generation index ${maxGeneratingTreeIndex} and commitment index` +
          ` ${maxCommitmentTreeIndex}`,
      );

      yield* Effect.promise(() =>
        emit.single(ProgressUpdate({ highestRelevantIndex: highestInitialIndex, appliedIndex: initialAppliedIndex })),
      );

      const rawGenerations = yield* pipe(
        indexerSyncService.subscribeDustGenerations(
          DustAddress.encodePublicKey(state.networkId, secretKey.publicKey),
          Number(lastSyncedBlockHeight),
          maxGeneratingTreeIndex,
          latestBlock,
        ),
        Stream.runCollect,
        Effect.map(Chunk.toArray),
      );
      const dustGenerationUpdates = DustGenerationsSyncUpdate.create(
        rawGenerations,
        secretKey,
        state.publicKey,
        lastSyncedGenerationIndex,
      );

      const allNullifiers = dustGenerationUpdates.newGenerations
        .map((n) => n.dustNullifier)
        .concat([...state.state.nullifiers.keys(), ...state.pendingDust.map((d) => d.nullifier)]);

      const highestRelevantIndex =
        maxGeneratingTreeIndex + maxCommitmentTreeIndex + allNullifiers.length * maxCommitmentTreeIndex;

      // increase the highestRelevantIndex as our nullifier list got expanded by new generations
      // appliedIndex now reflects the completed generation tree sync
      yield* Effect.promise(() =>
        emit.single(ProgressUpdate({ highestRelevantIndex, appliedIndex: maxGeneratingTreeIndex })),
      );

      const newUtxos = DustUtxoMap.create(dustGenerationUpdates.newGenerations);
      const { nextUtxos: finalUtxos, nextSpentUtxos: finalSpentUtxos } = yield* resolveNullifierSpends(
        allNullifiers,
        newUtxos,
        CoreWallet.pendingDustToMap(state.pendingDust),
        state.state,
        secretKey,
        latestBlock,
        dustGenerationUpdates,
        indexerSyncService,
        anonymityLevel,
        ledgerParametersCodecs,
        emit,
      );

      yield* Effect.promise(() =>
        emit.single(
          ProgressUpdate({ appliedIndex: maxGeneratingTreeIndex + allNullifiers.length * maxCommitmentTreeIndex }),
        ),
      );

      // lastSyncedCommitmentIndex out of maxCommitmentTreeIndex
      const collapsedCommitments = yield* loadCollapsedCommitments(
        Number(lastSyncedCommitmentIndex),
        maxCommitmentTreeIndex,
        finalUtxos,
        indexerSyncService,
      );

      yield* Effect.promise(() =>
        emit.single(
          StateUpdate({
            dustGenerations: dustGenerationUpdates,
            spentUtxos: finalSpentUtxos,
            newUtxos: finalUtxos,
            collapsedCommitments,
            latestBlock,
          }),
        ),
      );

      // NOTE: appliedIndex = highestRelevantIndex means we're fully synced
      yield* Effect.promise(() => emit.single(ProgressUpdate({ appliedIndex: highestRelevantIndex })));
      yield* Effect.promise(() => emit.end());
    }),
  );
};

export const makeEventLessSyncService = (
  config: DefaultSyncConfiguration,
): SyncService<CoreWallet, DustSecretKey, DustProjectionsUpdate> => {
  const defaultSyncService = makeDefaultSyncService(config);
  const indexerSyncService = makeIndexerSyncService(config);
  const anonymityLevel = config.anonymityLevel ?? 7;

  return {
    updates: (
      state: CoreWallet,
      secretKey: DustSecretKey,
    ): Stream.Stream<DustProjectionsUpdate, WalletError, Scope.Scope> =>
      pipe(
        doEventlessSync(
          state,
          secretKey,
          anonymityLevel,
          indexerSyncService,
          config.ledgerParametersCodecs ?? defaultLedgerParametersCodecs,
        ),
        Stream.provideSomeLayer(Layer.merge(indexerSyncService.connectionLayer(), indexerSyncService.queryClient())),
      ),
    blockData: defaultSyncService.blockData,
  };
};

export type IndexerSyncService = {
  connectionLayer: () => Layer.Layer<SubscriptionClient, WalletError, Scope.Scope>;
  subscribeWallet: (
    state: CoreWallet,
  ) => Stream.Stream<WalletSyncSubscription, WalletError, Scope.Scope | SubscriptionClient>;
  subscribeDustGenerations: (
    dustAddress: string,
    lastSyncedBlockHeight: number,
    maxGeneratingTreeIndex: number,
    latestBlock: BlockData,
  ) => Stream.Stream<DustGenerationsSubscription, WalletError, Scope.Scope | SubscriptionClient>;
  subscribeDustNullifierTransactions: (
    dustNullifiers: Arr.NonEmptyReadonlyArray<DustNullifier>,
    toBlock: number | null,
    prefixLength: number,
  ) => Stream.Stream<DustNullifierTransactionsSubscription, WalletError, Scope.Scope | SubscriptionClient>;
  dustCommitmentMerkleTreeUpdate: (
    startIndex: number,
    endIndex: number,
  ) => Effect.Effect<CollapsedMerkleTree, WalletError, Scope.Scope | QueryClient>;
  queryClient: () => Layer.Layer<QueryClient, WalletError, Scope.Scope>;
  blockData: (height?: number) => Effect.Effect<BlockData, WalletError, Scope.Scope | QueryClient>;
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
    subscribeDustGenerations(
      dustAddress: string,
      lastSyncedBlockHeight: number,
      maxGeneratingTreeIndex: number,
      latestBlock: BlockData,
    ): Stream.Stream<DustGenerationsSubscription, WalletError, Scope.Scope | SubscriptionClient> {
      if (maxGeneratingTreeIndex < 0 || (latestBlock.height === lastSyncedBlockHeight && lastSyncedBlockHeight !== 0)) {
        return Stream.empty;
      }

      return pipe(
        DustGenerationEvents.run({
          dustAddress,
          blockHash: latestBlock.hash,
          dtimeCutoffHeight: lastSyncedBlockHeight,
        }),
        Stream.mapEffect((subscription) => {
          return pipe(
            Schema.decodeUnknownEither(DustGenerationsSubscriptionSchema)(subscription.dustGenerations),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          );
        }),
        Stream.mapError((error) => new SyncWalletError(error)),
      );
    },
    subscribeDustNullifierTransactions(
      dustNullifiers: Arr.NonEmptyReadonlyArray<DustNullifier>,
      toBlock: number | null,
      prefixLength: number,
    ): Stream.Stream<DustNullifierTransactionsSubscription, WalletError, Scope.Scope | SubscriptionClient> {
      // fixed 32-byte little-endian form — the encoding nullifierLeBytes uses on the wire
      const hexedNullifiers = HashSet.fromIterable(dustNullifiers.map((n) => bigintToLeHex(n, NULLIFIER_BYTE_LENGTH)));
      return pipe(
        DustNullifierTransactions.run({
          nullifierLeBytesPrefixes: uniqueArray([...hexedNullifiers].map((n) => n.substring(0, prefixLength))),
          fromBlock: 0,
          toBlock,
        }),
        Stream.filter((subscription) =>
          HashSet.has(hexedNullifiers, subscription.dustNullifierTransactions.nullifierLeBytes),
        ),
        Stream.mapEffect((subscription) => {
          return pipe(
            Schema.decodeUnknownEither(DustNullifierTransactionSubscriptionSchema)(
              subscription.dustNullifierTransactions,
            ),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          );
        }),
        Stream.mapError((error) => new SyncWalletError(error)),
      );
    },
    dustCommitmentMerkleTreeUpdate(
      startIndex: number,
      endIndex: number,
    ): Effect.Effect<CollapsedMerkleTree, WalletError, Scope.Scope | QueryClient> {
      return pipe(
        DustCommitmentMerkleTreeUpdate.run({ startIndex, endIndex }),
        Effect.flatMap((result) => {
          return pipe(
            Schema.decodeUnknownEither(CollapsedMerkleTreeSchema)(result.dustCommitmentMerkleTreeUpdate),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          );
        }),
        Effect.catchAll((err) =>
          Effect.fail(new OtherWalletError({ message: `Encountered unexpected error: ${err.message}`, cause: err })),
        ),
      );
    },
    blockData: (height?: number): Effect.Effect<BlockData, WalletError, Scope.Scope | QueryClient> => {
      return pipe(
        BlockHash.run({ offset: height !== undefined ? { height } : null }),
        Effect.mapError(
          (err) => new OtherWalletError({ message: `Encountered unexpected error: ${err.message}`, cause: err }),
        ),
        Effect.flatMap((result): Effect.Effect<BlockData, WalletError> => {
          if (!result.block) {
            return Effect.fail(new OtherWalletError({ message: 'Unable to fetch block data' }));
          }
          return pipe(
            Schema.decodeUnknownEither(
              makeBlockDataSchema(config.ledgerParametersCodecs ?? defaultLedgerParametersCodecs),
            )(result.block),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          );
        }),
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

/**
 * The projections-based fast-sync capability.
 *
 * @remarks
 *   **This path does not implement the fork boundary, and cannot yet.** It takes `activeRange` for signature parity with
 *   the other capabilities and deliberately ignores it: a projections update is a folded snapshot of dust state —
 *   Merkle tree updates, new and spent UTXOs, a block header — not a sequence of version-tagged timeline items, so
 *   there is nothing in it to split and nothing that reports the protocol version a piece of it belongs to. `BlockData`
 *   carries height, hash, timestamp and ledger parameters, but no version.
 *
 *   A wallet syncing through this path therefore never annotates a version and never hands over. Closing that needs a
 *   version on the projections wire format, which is the same deferred indexer question as the one on
 *   `SyncEventsUpdateSchema` — recorded here rather than papered over with a boundary check that would silently do
 *   nothing.
 *
 *   The version watcher {@link makeDefaultSyncService} carries does not close it either, and is deliberately not fitted to
 *   {@link makeEventLessSyncService}: the watcher's gate is "the wallet is level with the source's dust event ids", and
 *   this path keeps no such cursor — its `appliedIndex` counts Merkle indices and nullifier scans, not events — so
 *   there is nothing here for the gate to compare against.
 */
export const makeEventLessSyncCapability = (): SyncCapability<CoreWallet, DustProjectionsUpdate, ChangesResult> => {
  return {
    applyUpdate(
      state: CoreWallet,
      update: DustProjectionsUpdate,
      _activeRange: ProtocolVersion.ProtocolVersion.Range,
    ): [CoreWallet, ChangesResult] {
      if (isProgressUpdate(update)) {
        return [
          CoreWallet.updateProgress(state, {
            appliedIndex: BigInt(update.appliedIndex ?? state.progress.appliedIndex),
            highestRelevantWalletIndex: BigInt(
              update.highestRelevantIndex ?? state.progress.highestRelevantWalletIndex,
            ),
            isConnected: true,
          }),
          { changes: [], protocolVersion: Number(state.protocolVersion) },
        ];
      }

      const { dustGenerations, spentUtxos, newUtxos, collapsedCommitments, latestBlock } = update;

      const dustGenTreeUpdates = dustGenerations.rawUpdates
        .filter((u) => u.__typename === 'DustGenerationsItem' || u.__typename === 'DustGenerationsProgress')
        .map((u) => u.collapsedMerkleTree)
        .filter((update): update is CollapsedMerkleTree => update !== null)
        .toSorted((u1, u2) => u1.startIndex - u2.startIndex);

      const walletWithAppliedUpdates = pipe(
        CoreWallet.applyDustGenerations(
          state,
          dustGenTreeUpdates,
          dustGenerations.newGenerations,
          dustGenerations.generationDtimeUpdates,
        ),
        (wallet) => CoreWallet.applyNewDustUtxos(wallet, newUtxos),
        (wallet) => CoreWallet.applyDustCommitments(wallet, newUtxos, collapsedCommitments),
        (wallet) => CoreWallet.applySpentNullifiers(wallet, [...HashMap.keys(spentUtxos)]),
      );

      const groupedNewUtxos = hashMapGroupBy([...HashMap.values(newUtxos)], (u) => u.transactionId);
      const groupedSpentUtxos = hashMapGroupBy([...HashMap.values(spentUtxos)], (u) => u.transactionId);

      const transactionIds = uniqueArray([
        ...HashMap.keys(groupedNewUtxos),
        ...HashMap.keys(groupedSpentUtxos),
      ]).toSorted();

      const changes: DustStateChanges[] = transactionIds.map((txId) => {
        const received = Option.getOrElse(HashMap.get(groupedNewUtxos, txId), () => []);
        const spent = Option.getOrElse(HashMap.get(groupedSpentUtxos, txId), () => []);
        const txHash = (received.at(0)?.transactionHash || spent.at(0)?.transactionHash)!;
        return new DustStateChanges(
          txHash,
          received.map(({ qdo }) => qdo),
          spent.map(({ qdo }) => qdo),
        );
      });

      // `processTtls` returns a fresh WASM-backed state. Mutating only that owned copy keeps this capability from
      // changing the input state when an update contains no tree or UTXO changes.
      const updatedDustState = walletWithAppliedUpdates.state.processTtls(latestBlock.timestamp);
      updatedDustState.syncTime = latestBlock.timestamp;
      const walletAtLatestBlock = { ...walletWithAppliedUpdates, state: updatedDustState };

      const newCommitmentTreeRoot =
        walletAtLatestBlock.state.commitmentTreeRoot() !== undefined
          ? leBigintToHex(walletAtLatestBlock.state.commitmentTreeRoot()!)
          : '';
      const newGeneratingTreeRoot =
        walletAtLatestBlock.state.generatingTreeRoot() !== undefined
          ? leBigintToHex(walletAtLatestBlock.state.generatingTreeRoot()!)
          : '';

      // verify root hashes
      if (
        newCommitmentTreeRoot !== update.latestBlock.dustCommitmentMerkleTreeRoot ||
        newGeneratingTreeRoot !== update.latestBlock.dustGenerationMerkleTreeRoot
      ) {
        // `SyncCapability.applyUpdate` has no typed error channel, so throwing preserves its public tuple-returning API;
        // `RunningV2Variant` catches this at the capability boundary. See #572 for the planned `Either`-based API.
        throw new OtherWalletError({ message: 'Root hashes don`t match' });
      }

      const updatedWallet = CoreWallet.updateProgress(walletAtLatestBlock, {
        highestIndex: BigInt(update.latestBlock.height),
      });

      return [updatedWallet, { changes, protocolVersion: Number(state.protocolVersion) }];
    },
  };
};

const createUtxoUpdatesFromSpend = (
  dustState: DustLocalState,
  secretKey: DustSecretKey,
  knownUtxos: Readonly<DustUtxoMap>,
  pendingDust: Map<DustNullifier, Dust>,
  generationDtimeUpdates: ReadonlyArray<DustGenerationDtimUpdate>,
  transaction: NullifierRegularTransaction,
  dustSpend: DustSpendProcessedEvent,
  ledgerParametersCodecs: LedgerParametersCodec.LedgerParametersCodecs<LedgerParameters>,
): Effect.Effect<Option.Option<[DustUtxoUpdate, DustUtxoUpdate]>, SyncWalletError> =>
  Effect.gen(function* () {
    const { nullifier, vFee, commitmentIndex, declaredTime } = dustSpend;
    const knownUtxo = Option.getOrUndefined(HashMap.get(knownUtxos, nullifier));
    const qdo = knownUtxo?.qdo ?? pendingDust.get(nullifier) ?? dustState.findUtxoByNullifier(nullifier);
    if (!qdo) {
      // A matched transaction carries every dust spend it contains, including other parties' (e.g. the counterparty
      // of a multi-intent transaction paying its own fees). Those nullifiers can never resolve locally — skip them.
      yield* Effect.logDebug(`Skipping dust spend of a nullifier not owned by this wallet: ${nullifier}`);
      return Option.none();
    }
    const genInfo = knownUtxo?.genInfo ?? dustState.generationInfo(qdo);
    if (!genInfo) {
      return yield* new SyncWalletError({ message: `Failed to find generation info for: ${qdo.backingNight}` });
    }
    const dtimeUpdate = generationDtimeUpdates.find((upd) => upd.nightUtxoHash === genInfo.nonce);
    const updatedGenInfo = dtimeUpdate !== undefined ? { ...genInfo, dtime: dtimeUpdate.newDtime } : genInfo;
    const txMeta = { transactionId: transaction.id, transactionHash: transaction.hash, genInfo: updatedGenInfo };
    const spentUtxoUpdate: DustUtxoUpdate = { dustNullifier: nullifier, qdo, isSpent: true, ...txMeta };
    // Read here rather than on arrival: the lookup matches on a nullifier prefix and searches from block zero, so most
    // of what it returns is other parties' — and, on a chain that has forked, some of it is the previous ledger
    // version's. Only a block holding a spend of this wallet's own is ever handed to a codec.
    const blockParameters = yield* pipe(
      readNullifierBlockParameters(transaction.block, ledgerParametersCodecs),
      Either.mapLeft((error) => new SyncWalletError({ message: error.message, cause: error })),
      EitherOps.toEffect,
    );
    const successorUtxo = successorDustUtxo(
      qdo,
      declaredTime,
      vFee,
      commitmentIndex,
      updatedGenInfo,
      secretKey,
      blockParameters.dust,
    );
    const newUtxoUpdate: DustUtxoUpdate = {
      dustNullifier: dustNullifier(successorUtxo, secretKey),
      qdo: successorUtxo,
      isSpent: false,
      ...txMeta,
    };
    return Option.some<[DustUtxoUpdate, DustUtxoUpdate]>([spentUtxoUpdate, newUtxoUpdate]);
  });

/** A dust spend a nullifier lookup turned up, paired with the transaction that carries it. */
export type MatchedDustSpend = Readonly<{
  transaction: NullifierRegularTransaction;
  dustSpend: DustSpendProcessedEvent;
}>;

/**
 * Reads the dust spends out of the transactions a nullifier lookup matched.
 *
 * @remarks
 *   Separate from resolving them, because this is the step that touches bytes. The lookup matches on a nullifier _prefix_
 *   and searches from block zero, so it deliberately over-delivers: most of what it returns belongs to other parties,
 *   and on a chain that has forked some of it belongs to the previous ledger version. An event this ledger version
 *   cannot read is therefore by construction not one of this wallet's spends, and is skipped rather than failing the
 *   whole lookup — which would take every dust spend this wallet ever made down with it.
 * @param nullifierTransactions The transactions the lookup matched.
 * @returns The dust spends among them, in source order.
 */
export const matchedDustSpends = (
  nullifierTransactions: ReadonlyArray<DustNullifierTransactionsSubscription>,
): readonly MatchedDustSpend[] =>
  pipe(
    nullifierTransactions,
    Arr.filterMap(({ transaction }) =>
      transaction.__typename === 'RegularTransaction' ? Option.some(transaction) : Option.none(),
    ),
    Arr.dedupeAdjacentWith((a, b) => a.id === b.id),
    Arr.flatMap((transaction) =>
      Arr.filterMap(transaction.dustLedgerEvents, (event) =>
        pipe(
          tryReadEvent(event),
          Option.flatMap((decoded) =>
            decoded.content.tag === 'dustSpendProcessed'
              ? Option.some({ transaction, dustSpend: decoded.content as DustSpendProcessedEvent })
              : Option.none(),
          ),
        ),
      ),
    ),
  );

export const createDustUtxoUpdates = (
  dustState: DustLocalState,
  spends: ReadonlyArray<MatchedDustSpend>,
  secretKey: DustSecretKey,
  knownUtxos: Readonly<DustUtxoMap>,
  pendingDust: Map<DustNullifier, Dust>,
  generationDtimeUpdates: ReadonlyArray<DustGenerationDtimUpdate>,
  ledgerParametersCodecs: LedgerParametersCodec.LedgerParametersCodecs<LedgerParameters> = defaultLedgerParametersCodecs,
): Effect.Effect<DustUtxoUpdate[], SyncWalletError> =>
  pipe(
    spends,
    Arr.map(({ transaction, dustSpend }) =>
      createUtxoUpdatesFromSpend(
        dustState,
        secretKey,
        knownUtxos,
        pendingDust,
        generationDtimeUpdates,
        transaction,
        dustSpend,
        ledgerParametersCodecs,
      ),
    ),
    Effect.all,
    Effect.map(Arr.getSomes),
    Effect.map(Arr.flatten),
  );

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
          protocolVersion: Number(lastBlock.protocolVersion),
          ledgerParameters: state.ledger.parameters,
          timestamp: state.currentTime,
          zswapEndIndex: 1, // NOTE: not implemented
          dustCommitmentEndIndex: 1, // NOTE: not implemented
          dustGenerationEndIndex: 1, // NOTE: not implemented
          dustCommitmentMerkleTreeRoot: '', // NOTE: not implemented
          dustGenerationMerkleTreeRoot: '', // NOTE: not implemented
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
      const lastBlock = getLastBlock(update.update);
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
