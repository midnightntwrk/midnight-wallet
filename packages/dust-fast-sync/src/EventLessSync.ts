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
  Chunk,
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
} from 'effect';
import { type DustSecretKey, type DustStateChanges } from '@midnight-ntwrk/ledger-v8';
// The rc ledger (8.2.0-rc.1) provides successorDustUtxo and the projections state operations that 8.1.0 lacks. All
// internal state handling runs on rc instances (see StateOps); the base import above only appears in the seam types
// shared with the dust wallet, which stays on 8.1.0.
import {
  DustSecretKey as RcDustSecretKey,
  dustNullifier,
  successorDustUtxo,
  type DustLocalState as RcDustLocalState,
  type DustNullifier,
} from '@midnight-ntwrk/ledger-v8-rc';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import {
  DustGenerationEvents,
  DustNullifierTransactions,
  DustCommitmentMerkleTreeUpdate,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import { type SubscriptionClient, type QueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import {
  CoreWallet,
  SyncService as DustSync,
  WalletError as DustWalletError,
  type BlockData,
  type Dust,
} from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
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
  type DustGenerationDtimUpdate,
  type NullifierRegularTransaction,
  ProgressUpdate,
  StateUpdate,
  isProgressUpdate,
} from './SyncSchema.js';
import {
  applyDustCommitments,
  applyDustGenerations,
  applyNewDustUtxos,
  applySpentNullifiers,
  toBaseState,
  toRcState,
} from './StateOps.js';
import {
  bigintToLeHex,
  calculatePrefixLength,
  gapRanges,
  hashMapGroupBy,
  leBigintToHex,
  uniqueArray,
} from './Utils.js';

export type EventLessSyncConfiguration = DustSync.DefaultSyncConfiguration & {
  /**
   * Seed of the wallet's dust secret key (the same seed passed to the dust wallet's `startWithSeed`). The projections
   * sync runs on its own copy of the ledger (8.2.0-rc.1) and WASM key instances cannot cross module copies, so the key
   * is re-derived from this seed inside the sync. It must derive the same key that is passed to `start`/`doSync` — the
   * sync fails with a `SyncWalletError` when the public keys do not match.
   */
  dustKeySeed: Uint8Array;
  anonymityLevel?: number;
};

export type ProjectionsIndexerService = DustSync.IndexerSyncService & {
  subscribeDustGenerations: (
    dustAddress: string,
    lastSyncedBlockHeight: number,
    maxGeneratingTreeIndex: number,
    latestBlock: BlockData,
  ) => Stream.Stream<DustGenerationsSubscription, DustWalletError.WalletError, Scope.Scope | SubscriptionClient>;
  subscribeDustNullifierTransactions: (
    dustNullifiers: Arr.NonEmptyReadonlyArray<DustNullifier>,
    toBlock: number | null,
    prefixLength: number,
  ) => Stream.Stream<
    DustNullifierTransactionsSubscription,
    DustWalletError.WalletError,
    Scope.Scope | SubscriptionClient
  >;
  dustCommitmentMerkleTreeUpdate: (
    startIndex: number,
    endIndex: number,
  ) => Effect.Effect<CollapsedMerkleTree, DustWalletError.WalletError, Scope.Scope | QueryClient>;
};

const NULLIFIER_BYTE_LENGTH = 32;
const NULLIFIER_LENGTH = NULLIFIER_BYTE_LENGTH * 2;

export const makeProjectionsIndexerService = (config: DustSync.DefaultSyncConfiguration): ProjectionsIndexerService => {
  return {
    ...DustSync.makeIndexerSyncService(config),
    subscribeDustGenerations(
      dustAddress: string,
      lastSyncedBlockHeight: number,
      maxGeneratingTreeIndex: number,
      latestBlock: BlockData,
    ): Stream.Stream<DustGenerationsSubscription, DustWalletError.WalletError, Scope.Scope | SubscriptionClient> {
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
            Either.mapLeft((err) => new DustWalletError.SyncWalletError(err)),
            EitherOps.toEffect,
          );
        }),
        Stream.mapError((error) => new DustWalletError.SyncWalletError(error)),
      );
    },
    subscribeDustNullifierTransactions(
      dustNullifiers: Arr.NonEmptyReadonlyArray<DustNullifier>,
      toBlock: number | null,
      prefixLength: number,
    ): Stream.Stream<
      DustNullifierTransactionsSubscription,
      DustWalletError.WalletError,
      Scope.Scope | SubscriptionClient
    > {
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
            Either.mapLeft((err) => new DustWalletError.SyncWalletError(err)),
            EitherOps.toEffect,
          );
        }),
        Stream.mapError((error) => new DustWalletError.SyncWalletError(error)),
      );
    },
    dustCommitmentMerkleTreeUpdate(
      startIndex: number,
      endIndex: number,
    ): Effect.Effect<CollapsedMerkleTree, DustWalletError.WalletError, Scope.Scope | QueryClient> {
      return pipe(
        DustCommitmentMerkleTreeUpdate.run({ startIndex, endIndex }),
        Effect.flatMap((result) => {
          return pipe(
            Schema.decodeUnknownEither(CollapsedMerkleTreeSchema)(result.dustCommitmentMerkleTreeUpdate),
            Either.mapLeft((err) => new DustWalletError.SyncWalletError(err)),
            EitherOps.toEffect,
          );
        }),
        Effect.catchAll((err) =>
          Effect.fail(
            new DustWalletError.OtherWalletError({
              message: `Encountered unexpected error: ${err.message}`,
              cause: err,
            }),
          ),
        ),
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
  indexerSyncService: ProjectionsIndexerService,
): Effect.Effect<CollapsedMerkleTree[], DustWalletError.WalletError, Scope.Scope | QueryClient> => {
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
  dustState: RcDustLocalState,
  secretKey: RcDustSecretKey,
  latestBlock: BlockData,
  dustGenerationUpdates: DustGenerationsSyncUpdate,
  indexerSyncService: ProjectionsIndexerService,
  anonymityLevel: number,
  emit: {
    single: (update: DustProjectionsUpdate) => Promise<void>;
  },
): Effect.Effect<
  { nextUtxos: DustUtxoMap; nextSpentUtxos: DustUtxoMap },
  DustWalletError.WalletError,
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
  secretKey: RcDustSecretKey,
  anonymityLevel: number,
  indexerSyncService: ProjectionsIndexerService,
): Stream.Stream<
  DustProjectionsUpdate,
  DustWalletError.WalletError,
  Scope.Scope | QueryClient | SubscriptionClient
> => {
  return Stream.asyncEffect((emit) =>
    Effect.gen(function* () {
      // The wallet state holds a base-module (8.1.0) DustLocalState; re-materialize it in the rc module to access
      // the projections accessors (nullifiers, *TreeFirstFree) and to feed the rc-only state operations.
      const rcState = toRcState(state.state);
      const latestBlock = yield* indexerSyncService.blockData();
      const maxCommitmentTreeIndex = latestBlock.dustCommitmentEndIndex - 1;
      const maxGeneratingTreeIndex = latestBlock.dustGenerationEndIndex - 1;
      const lastSyncedCommitmentIndex = rcState.commitmentTreeFirstFree - 1n;
      const lastSyncedGenerationIndex = rcState.generatingTreeFirstFree - 1n;
      const lastSyncedBlockHeight = state.progress.highestIndex;

      const highestInitialIndex =
        maxGeneratingTreeIndex + maxCommitmentTreeIndex + rcState.nullifiers.size * maxCommitmentTreeIndex;
      const initialAppliedIndex =
        Number(lastSyncedGenerationIndex) +
        Number(lastSyncedCommitmentIndex) +
        rcState.nullifiers.size * Number(maxCommitmentTreeIndex);

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
        .concat([...rcState.nullifiers.keys(), ...state.pendingDust.map((d) => d.nullifier)]);

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
        rcState,
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
  config: EventLessSyncConfiguration,
): DustSync.SyncService<CoreWallet, DustSecretKey, DustProjectionsUpdate> => {
  const defaultSyncService = DustSync.makeDefaultSyncService(config);
  const indexerSyncService = makeProjectionsIndexerService(config);
  const anonymityLevel = config.anonymityLevel ?? 7;

  return {
    updates: (
      state: CoreWallet,
      secretKey: DustSecretKey,
    ): Stream.Stream<DustProjectionsUpdate, DustWalletError.WalletError, Scope.Scope> =>
      pipe(
        Stream.acquireRelease(
          Effect.sync(() => RcDustSecretKey.fromSeed(config.dustKeySeed)),
          (key) => Effect.sync(() => key.clear()),
        ),
        Stream.flatMap((rcSecretKey) =>
          // Public keys are plain bigints, so comparing them across the two ledger copies is sound.
          rcSecretKey.publicKey === secretKey.publicKey
            ? doEventlessSync(state, rcSecretKey, anonymityLevel, indexerSyncService)
            : Stream.fail(
                new DustWalletError.SyncWalletError({
                  message: 'dustKeySeed in the sync configuration does not derive the provided dust secret key',
                }),
              ),
        ),
        Stream.provideSomeLayer(Layer.merge(indexerSyncService.connectionLayer(), indexerSyncService.queryClient())),
      ),
    blockData: defaultSyncService.blockData,
  };
};

export const makeEventLessSyncCapability = (): DustSync.SyncCapability<
  CoreWallet,
  DustProjectionsUpdate,
  DustSync.ChangesResult
> => {
  return {
    applyUpdate(state: CoreWallet, update: DustProjectionsUpdate): [CoreWallet, DustSync.ChangesResult] {
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

      // Re-materialize the wallet's base-module (8.1.0) state in the rc module: an owned copy, so the rc-only
      // operations (and the syncTime write below) never touch the input state.
      const rcState = toRcState(state.state);
      const spentNullifiers = [...HashMap.keys(spentUtxos)];

      const stateWithAppliedUpdates = pipe(
        applyDustGenerations(
          rcState,
          dustGenTreeUpdates,
          dustGenerations.newGenerations,
          dustGenerations.generationDtimeUpdates,
        ),
        (rc) => applyNewDustUtxos(rc, newUtxos),
        (rc) => applyDustCommitments(rc, newUtxos, collapsedCommitments),
        (rc) => applySpentNullifiers(rc, spentNullifiers),
      );

      const groupedNewUtxos = hashMapGroupBy([...HashMap.values(newUtxos)], (u) => u.transactionId);
      const groupedSpentUtxos = hashMapGroupBy([...HashMap.values(spentUtxos)], (u) => u.transactionId);

      const transactionIds = uniqueArray([
        ...HashMap.keys(groupedNewUtxos),
        ...HashMap.keys(groupedSpentUtxos),
      ]).toSorted();

      // Plain objects on purpose: the base (8.1.0) DustStateChanges constructor is private and the consuming
      // transaction-history service only reads source/receivedUtxos/spentUtxos.
      const changes: DustStateChanges[] = transactionIds.map((txId) => {
        const received = Option.getOrElse(HashMap.get(groupedNewUtxos, txId), () => []);
        const spent = Option.getOrElse(HashMap.get(groupedSpentUtxos, txId), () => []);
        const txHash = (received.at(0)?.transactionHash || spent.at(0)?.transactionHash)!;
        return {
          source: txHash,
          receivedUtxos: received.map(({ qdo }) => qdo),
          spentUtxos: spent.map(({ qdo }) => qdo),
        };
      });

      const updatedDustState = stateWithAppliedUpdates.processTtls(latestBlock.timestamp);
      updatedDustState.syncTime = latestBlock.timestamp;

      const newCommitmentTreeRoot =
        updatedDustState.commitmentTreeRoot() !== undefined
          ? leBigintToHex(updatedDustState.commitmentTreeRoot()!)
          : '';
      const newGeneratingTreeRoot =
        updatedDustState.generatingTreeRoot() !== undefined
          ? leBigintToHex(updatedDustState.generatingTreeRoot()!)
          : '';

      // verify root hashes
      if (
        newCommitmentTreeRoot !== update.latestBlock.dustCommitmentMerkleTreeRoot ||
        newGeneratingTreeRoot !== update.latestBlock.dustGenerationMerkleTreeRoot
      ) {
        // `SyncCapability.applyUpdate` has no typed error channel, so throwing preserves its public tuple-returning API;
        // `RunningV1Variant` catches this at the capability boundary. See #572 for the planned `Either`-based API.
        throw new DustWalletError.OtherWalletError({ message: 'Root hashes don`t match' });
      }

      const updatedWallet = CoreWallet.updateProgress(
        {
          ...state,
          state: toBaseState(updatedDustState),
          pendingDust: state.pendingDust.filter((d) => !spentNullifiers.includes(d.nullifier)),
        },
        {
          highestIndex: BigInt(update.latestBlock.height),
        },
      );

      return [updatedWallet, { changes, protocolVersion: Number(state.protocolVersion) }];
    },
  };
};

const createUtxoUpdatesFromSpend = (
  dustState: RcDustLocalState,
  secretKey: RcDustSecretKey,
  knownUtxos: Readonly<DustUtxoMap>,
  pendingDust: Map<DustNullifier, Dust>,
  generationDtimeUpdates: ReadonlyArray<DustGenerationDtimUpdate>,
  transaction: NullifierRegularTransaction,
  dustSpend: DustSpendProcessedEvent,
): Effect.Effect<Option.Option<[DustUtxoUpdate, DustUtxoUpdate]>, DustWalletError.SyncWalletError> =>
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
      return yield* new DustWalletError.SyncWalletError({
        message: `Failed to find generation info for: ${qdo.backingNight}`,
      });
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
  dustState: RcDustLocalState,
  nullifierTransactions: ReadonlyArray<DustNullifierTransactionsSubscription>,
  secretKey: RcDustSecretKey,
  knownUtxos: Readonly<DustUtxoMap>,
  pendingDust: Map<DustNullifier, Dust>,
  generationDtimeUpdates: ReadonlyArray<DustGenerationDtimUpdate>,
): Effect.Effect<DustUtxoUpdate[], DustWalletError.SyncWalletError> =>
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
