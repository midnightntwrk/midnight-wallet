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
} from 'effect';
import {
  dustNullifier,
  successorDustUtxo,
  type DustNullifier,
  type DustSecretKey,
  DustStateChanges,
  type DustLocalState,
} from '@midnight-ntwrk/ledger-v8';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import {
  DustGenerationEvents,
  BlockHash,
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
import {
  type Simulator,
  type SimulatorState,
  getBlockEventsFrom,
  getLastBlock,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
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
  type WalletSyncSubscription,
  WalletSyncUpdate,
  BlockDataSchema,
  type BlockData,
  type DustGenerationDtimUpdate,
  type NullifierRegularTransaction,
  ProgressUpdate,
  StateUpdate,
  isProgressUpdate,
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
  applyUpdate: (state: TState, update: TUpdate) => [TState, TResult];
}

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
  anonymityLevel?: number;
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
            nullifierTransactions,
            secretKey,
            newUtxos,
            pendingDust,
            dustGenerationUpdates.generationDtimeUpdates,
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
        doEventlessSync(state, secretKey, anonymityLevel, indexerSyncService),
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
        Stream.mapEffect((subscription) => {
          return pipe(
            Schema.decodeUnknownEither(DustNullifierTransactionSubscriptionSchema)(
              subscription.dustNullifierTransactions,
            ),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          );
        }),
        Stream.filter((record) => HashSet.has(hexedNullifiers, record.nullifierLeBytes)),
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
        Effect.flatMap((result) => {
          if (!result.block) {
            throw new OtherWalletError({ message: 'Unable to fetch block data' });
          }
          return pipe(
            Schema.decodeUnknownEither(BlockDataSchema)(result.block),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          );
        }),
        Effect.catchAll((err) =>
          Effect.fail(new OtherWalletError({ message: `Encountered unexpected error: ${err.message}`, cause: err })),
        ),
      );
    },
  };
};

export const makeDefaultSyncCapability = (): SyncCapability<CoreWallet, WalletSyncUpdate, ChangesResult> => {
  return {
    applyUpdate(state: CoreWallet, wrappedUpdate: WalletSyncUpdate): [CoreWallet, ChangesResult] {
      const { updates, secretKey } = wrappedUpdate;

      // Nothing to update yet
      if (updates.length === 0) {
        return [state, { changes: [], protocolVersion: Number(state.protocolVersion) }];
      }

      const appliedIndex = state.progress.appliedIndex;
      const freshUpdates = updates.filter((u) => BigInt(u.id) > appliedIndex);

      const highestRelevantWalletIndex = BigInt(updates.at(-1)!.maxId);

      const [newState, changes]: [CoreWallet, DustStateChanges[]] =
        freshUpdates.length === 0
          ? [state, []]
          : CoreWallet.applyEventsWithChanges(
              state,
              secretKey,
              freshUpdates.map((u) => u.raw),
              wrappedUpdate.timestamp,
            );

      const updatedState = CoreWallet.updateProgress(newState, {
        appliedIndex: freshUpdates.length === 0 ? appliedIndex : BigInt(freshUpdates.at(-1)!.id),
        highestRelevantWalletIndex,
        isConnected: true,
      });

      return [updatedState, { changes, protocolVersion: Number(updatedState.protocolVersion) }];
    },
  };
};

export const makeEventLessSyncCapability = (): SyncCapability<CoreWallet, DustProjectionsUpdate, ChangesResult> => {
  return {
    applyUpdate(state: CoreWallet, update: DustProjectionsUpdate): [CoreWallet, ChangesResult] {
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
        // `RunningV1Variant` catches this at the capability boundary. See #572 for the planned `Either`-based API.
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
    const successorUtxo = successorDustUtxo(
      qdo,
      declaredTime,
      vFee,
      commitmentIndex,
      updatedGenInfo,
      secretKey,
      transaction.block.ledgerParameters.dust,
    );
    const newUtxoUpdate: DustUtxoUpdate = {
      dustNullifier: dustNullifier(successorUtxo, secretKey),
      qdo: successorUtxo,
      isSpent: false,
      ...txMeta,
    };
    return Option.some<[DustUtxoUpdate, DustUtxoUpdate]>([spentUtxoUpdate, newUtxoUpdate]);
  });

export const createDustUtxoUpdates = (
  dustState: DustLocalState,
  nullifierTransactions: ReadonlyArray<DustNullifierTransactionsSubscription>,
  secretKey: DustSecretKey,
  knownUtxos: Readonly<DustUtxoMap>,
  pendingDust: Map<DustNullifier, Dust>,
  generationDtimeUpdates: ReadonlyArray<DustGenerationDtimUpdate>,
): Effect.Effect<DustUtxoUpdate[], SyncWalletError> =>
  pipe(
    nullifierTransactions,
    Arr.filterMap(({ transaction }) =>
      transaction.__typename === 'RegularTransaction' ? Option.some(transaction) : Option.none(),
    ),
    Arr.dedupeAdjacentWith((a, b) => a.id === b.id),
    Arr.flatMap((transaction) =>
      Arr.filterMap(transaction.dustLedgerEvents, (event) =>
        event.raw.content.tag === 'dustSpendProcessed'
          ? Option.some({ transaction, dustSpend: event.raw.content as DustSpendProcessedEvent })
          : Option.none(),
      ),
    ),
    Arr.map(({ transaction, dustSpend }) =>
      createUtxoUpdatesFromSpend(
        dustState,
        secretKey,
        knownUtxos,
        pendingDust,
        generationDtimeUpdates,
        transaction,
        dustSpend,
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
    applyUpdate: (state: CoreWallet, update: SimulatorSyncUpdate): [CoreWallet, ChangesResult] => {
      const lastBlock = getLastBlock(update.update);
      // If no block exists yet (blank simulator), skip update
      if (lastBlock === undefined) {
        return [state, { changes: [], protocolVersion: Number(state.protocolVersion) }];
      }
      // Get all events from blocks starting at appliedIndex (the next block to process).
      // appliedIndex semantics: the first block number we haven't processed yet.
      // Initial: appliedIndex = 0 (haven't processed any blocks)
      // After processing block N: appliedIndex = N + 1 (next block to process)
      const events = [...getBlockEventsFrom(update.update, state.progress.appliedIndex)];
      const [newState, changes] = CoreWallet.applyEventsWithChanges(
        state,
        update.secretKey,
        events,
        lastBlock.timestamp,
      );
      const updatedState = CoreWallet.updateProgress(newState, {
        appliedIndex: lastBlock.number + 1n,
      });
      return [updatedState, { changes, protocolVersion: Number(updatedState.protocolVersion) }];
    },
  };
};
