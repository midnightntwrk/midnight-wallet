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
} from '@midnight-ntwrk/ledger-v8';
import {
  DustGenerationEvents,
  BlockHash,
  DustLedgerEvents,
  DustNullifierTransactions,
  DustCommitmentMerkleTreeUpdate,
} from '@midnight-ntwrk/wallet-sdk-indexer-client';
import {
  WsSubscriptionClient,
  HttpQueryClient,
  ConnectionHelper,
  type SubscriptionClient,
  type QueryClient,
} from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { type URLError, WsURL } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { OtherWalletError, SyncWalletError, type WalletError } from './WalletError.js';
import {
  type Simulator,
  type SimulatorState,
  getBlockEventsFrom,
  getLastBlock,
} from '@midnight-ntwrk/wallet-sdk-capabilities/simulation';
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
  type NewDustGeneration,
  type NullifierRegularTransaction,
} from './SyncSchema.js';
import { hashMapGroupBy, nullifierToHex, uniqueArray } from './Utils.js';

export interface SyncService<TState, TStartAux, TUpdate> {
  updates: (
    state: TState,
    auxData: TStartAux,
    onProgress?: (progress: number) => void,
  ) => Stream.Stream<TUpdate, WalletError, Scope.Scope>;
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
      onProgress?: (progress: number) => void,
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
      return Effect.gen(function* () {
        const query = yield* BlockHash;
        const result = yield* query({ offset: height !== undefined ? { height } : null });
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
          return pipe(
            Schema.decodeUnknownEither(BlockDataSchema)(blockData),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          );
        }),
      );
    },
  };
};

export const Trigger = Symbol('SyncTrigger');

export const makeEventLessSyncService =
  (trigger: Stream.Stream<typeof Trigger>) =>
  (config: DefaultSyncConfiguration): SyncService<CoreWallet, DustSecretKey, DustProjectionsUpdate> => {
    const defaultSyncService = makeDefaultSyncService(config);
    const indexerSyncService = makeIndexerSyncService(config);

    const loadCollapsedCommitments = (
      fromIndex: number,
      toIndex: number,
      newUtxos: Readonly<DustUtxoMap>,
    ): Effect.Effect<CollapsedMerkleTree[], WalletError, Scope.Scope | QueryClient> => {
      if (toIndex < 0) {
        return Effect.succeed([]);
      }

      const skipMtIndexes = [...newUtxos]
        .toSorted((a, b) => Number(a[1].qdo.mtIndex - b[1].qdo.mtIndex))
        .map(([_, u]) => Number(u.qdo.mtIndex));

      // 1: split into groups
      const groups = [];
      const firstSkipIndex = skipMtIndexes.at(0);

      if (firstSkipIndex !== undefined && fromIndex < firstSkipIndex) {
        groups.push({ start: fromIndex, end: firstSkipIndex - 1 });
      } else if (firstSkipIndex === undefined) {
        groups.push({ start: fromIndex, end: toIndex });
      }

      skipMtIndexes.forEach((skipMtIndex, index) => {
        const start = skipMtIndex + 1;
        const end = skipMtIndexes.at(index + 1);
        if (end !== undefined && end - start > 0) {
          groups.push({ start, end: end - 1 });
        } else if (end === undefined && start <= toIndex) {
          groups.push({ start, end: toIndex });
        }
      });

      // 2: Query all groups in parallel
      return pipe(
        groups.map(({ start, end }) => indexerSyncService.dustCommitmentMerkleTreeUpdate(start, end)),
        Effect.all,
      );
    };

    const doSync = (
      state: CoreWallet,
      secretKey: DustSecretKey,
      onProgress?: (progress: number) => void,
    ): Effect.Effect<DustProjectionsUpdate, WalletError, Scope.Scope | QueryClient | SubscriptionClient> => {
      console.log('syncing for: ', state.publicKey.addressHex);
      return Effect.gen(function* () {
        const blockData = yield* defaultSyncService.blockData();
        const maxCommitmentTreeIndex = blockData.dustCommitmentEndIndex - 1;
        const maxGeneratingTreeIndex = blockData.dustGenerationEndIndex - 1;
        const lastSyncedCommitmentIndex = state.state.commitmentTreeFirstFree;

        const rawGenerations = yield* pipe(
          indexerSyncService.subscribeDustGenerations(
            state.publicKey.address,
            Number(state.progress.appliedIndex),
            maxGeneratingTreeIndex,
          ),
          Stream.runCollect,
          Effect.map(Chunk.toArray),
        );
        console.log('dust generations received', rawGenerations.length);
        const dustGenerationUpdates = DustGenerationsSyncUpdate.create(rawGenerations, secretKey, state.publicKey);
        onProgress?.(10);

        // combine new nullifiers with those in the state
        const unsyncedNullifiers = dustGenerationUpdates.newGenerations
          .map((n) => n.dustNullifier)
          .concat([...state.state.nullifiers.keys()]);

        // track new utxos to calculate the successor utxo when the nullifier is spent
        const initialNewUtxos = DustUtxoMap.create(dustGenerationUpdates.newGenerations);

        const [finalUtxos, finalSpentUtxos] = yield* pipe(
          Stream.unfoldEffect(
            [unsyncedNullifiers, initialNewUtxos, HashMap.empty() as DustUtxoMap] as const,
            ([nullifiersToCheck, newUtxos, spentUtxos]) => {
              if (nullifiersToCheck.length === 0) {
                return Effect.succeed(Option.none());
              }
              return Effect.gen(function* () {
                const nullifierTransactions = yield* pipe(
                  indexerSyncService.subscribeDustNullifierTransactions(
                    nullifiersToCheck as Arr.NonEmptyArray<DustNullifier>,
                    blockData.height,
                  ),
                  Stream.runCollect,
                  Effect.map(Chunk.toArray),
                );
                const dustUtxoUpdates = yield* createDustUtxoUpdates(
                  state,
                  nullifierTransactions,
                  secretKey,
                  newUtxos,
                  dustGenerationUpdates.generationDtimeUpdates,
                );
                const { nextUtxos, nextSpentUtxos } = dustUtxoUpdates.reduce(
                  ({ nextUtxos, nextSpentUtxos }, update) => {
                    const entry = {
                      qdo: update.qdo,
                      transactionId: update.transactionId,
                      transactionHash: update.transactionHash,
                      genInfo: update.genInfo,
                    };
                    return update.isSpent
                      ? {
                          nextUtxos,
                          nextSpentUtxos: HashMap.set(nextSpentUtxos, update.dustNullifier, entry),
                        }
                      : { nextUtxos: HashMap.set(nextUtxos, update.dustNullifier, entry), nextSpentUtxos };
                  },
                  { nextUtxos: newUtxos, nextSpentUtxos: spentUtxos },
                );
                const nextNullifiers = dustUtxoUpdates.filter((u) => !u.isSpent).map((u) => u.dustNullifier);
                return Option.some([
                  [nextUtxos, nextSpentUtxos] as const,
                  [nextNullifiers, nextUtxos, nextSpentUtxos] as const,
                ]);
              });
            },
          ),
          Stream.runCollect,
          Effect.map(Chunk.toArray),
          Effect.map((results) =>
            pipe(
              Arr.last(results),
              Option.getOrElse(() => [initialNewUtxos, HashMap.empty()] as const),
            ),
          ),
        );

        // sanity check
        if ([...finalUtxos].some((u) => u[1].qdo.mtIndex < lastSyncedCommitmentIndex)) {
          return yield* Effect.fail(new OtherWalletError({ message: 'Spotted stale utxo' }));
        }

        onProgress?.(90);

        const collapsedCommitments = yield* loadCollapsedCommitments(
          Number(lastSyncedCommitmentIndex),
          maxCommitmentTreeIndex,
          finalUtxos,
        );

        onProgress?.(100);

        return {
          dustGenerations: dustGenerationUpdates,
          spentUtxos: finalSpentUtxos,
          newUtxos: finalUtxos,
          collapsedCommitments,
          lastBlockTimestamp: blockData.timestamp,
        };
      });
    };

    return {
      updates: (
        state: CoreWallet,
        secretKey: DustSecretKey,
        onProgress?: (progress: number) => void,
      ): Stream.Stream<DustProjectionsUpdate, WalletError, Scope.Scope> =>
        pipe(
          trigger,
          Stream.mapEffect(() => doSync(state, secretKey, onProgress)),
          Stream.provideSomeLayer(Layer.merge(indexerSyncService.connectionLayer(), indexerSyncService.queryClient())),
        ),
      blockData: (): Effect.Effect<BlockData, WalletError> => defaultSyncService.blockData(),
    };
  };

export type IndexerSyncService = {
  connectionLayer: () => Layer.Layer<SubscriptionClient, WalletError, Scope.Scope>;
  subscribeWallet: (
    state: CoreWallet,
  ) => Stream.Stream<WalletSyncSubscription, WalletError, Scope.Scope | SubscriptionClient>;
  subscribeDustGenerations: (
    dustAddress: string,
    startIndex: number,
    endIndex: number,
  ) => Stream.Stream<DustGenerationsSubscription, WalletError, Scope.Scope | SubscriptionClient>;
  subscribeDustNullifierTransactions: (
    dustNullifiers: Arr.NonEmptyReadonlyArray<DustNullifier>,
    toBlock: number | null,
  ) => Stream.Stream<DustNullifierTransactionsSubscription, WalletError, Scope.Scope | SubscriptionClient>;
  dustCommitmentMerkleTreeUpdate: (
    startIndex: number,
    endIndex: number,
  ) => Effect.Effect<CollapsedMerkleTree, WalletError, Scope.Scope | QueryClient>;
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
    subscribeDustGenerations(
      dustAddress: string,
      startIndex: number,
      endIndex: number,
    ): Stream.Stream<DustGenerationsSubscription, WalletError, Scope.Scope | SubscriptionClient> {
      console.log(
        'Subscribing to dust generations for address:',
        dustAddress,
        'from index:',
        startIndex,
        'to index:',
        endIndex,
      );

      if (endIndex < 0) {
        return Stream.empty;
      }

      return pipe(
        DustGenerationEvents.run({
          dustAddress,
          startIndex,
          endIndex,
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
    ): Stream.Stream<DustNullifierTransactionsSubscription, WalletError, Scope.Scope | SubscriptionClient> {
      const hexedNullifiers = HashSet.fromIterable(dustNullifiers.map(nullifierToHex));
      console.log(`Subscribing to dust nullifier transactions from block 0 to block ${toBlock}`);

      // TODO: replace with some specific number
      let prefixLength = [...hexedNullifiers].at(0)!.length / 2;
      if (prefixLength % 2 === 1) prefixLength -= 1;

      return pipe(
        DustNullifierTransactions.run({
          nullifierLeBytesPrefixes: [...hexedNullifiers].map((n) => n.substring(0, prefixLength)),
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

      const lastUpdate = updates.at(-1)!;
      const nextIndex = BigInt(lastUpdate.id);
      const highestRelevantWalletIndex = BigInt(lastUpdate.maxId);

      // in case the nextIndex is less than or equal to the current appliedIndex
      // just update highestRelevantWalletIndex
      if (nextIndex <= state.progress.appliedIndex) {
        return [
          CoreWallet.updateProgress(state, { highestRelevantWalletIndex, isConnected: true }),
          { changes: [], protocolVersion: Number(state.protocolVersion) },
        ];
      }

      const events = updates.map((u) => u.raw).filter((event) => event !== null);

      const [newState, changes] = CoreWallet.applyEventsWithChanges(state, secretKey, events, wrappedUpdate.timestamp);

      const updatedState = CoreWallet.updateProgress(newState, {
        appliedIndex: nextIndex,
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
      console.log(`Applying dust updates for wallet ${state.publicKey.addressHex}`, update);
      const { dustGenerations, spentUtxos, newUtxos, collapsedCommitments, lastBlockTimestamp } = update;

      const dustGenTreeUpdates = dustGenerations.rawUpdates
        .filter((u) => u.__typename === 'DustGenerationsItem' || u.__typename === 'DustGenerationsProgress')
        .filter((u) => u.collapsedMerkleTree !== null)
        .map((u) => u.collapsedMerkleTree as CollapsedMerkleTree)
        .toSorted((u1, u2) => u1.startIndex - u2.startIndex);

      let updatedWallet = CoreWallet.applyDustGenerations(
        state,
        dustGenTreeUpdates,
        dustGenerations.newGenerations,
        dustGenerations.generationDtimeUpdates,
      );
      updatedWallet = CoreWallet.applyNewDustUtxos(updatedWallet, newUtxos);
      updatedWallet = CoreWallet.applyDustCommitments(updatedWallet, newUtxos, collapsedCommitments);
      updatedWallet = CoreWallet.applySpentNullifiers(updatedWallet, [...HashMap.keys(spentUtxos)]);

      if (dustGenerations.lastUpdateIndex !== undefined) {
        updatedWallet = CoreWallet.updateProgress(updatedWallet, {
          appliedIndex: BigInt(dustGenerations.lastUpdateIndex),
          highestRelevantWalletIndex: BigInt(dustGenerations.lastUpdateIndex),
          isConnected: true,
        });
      }

      const groupedNewUtxos = hashMapGroupBy([...HashMap.values(newUtxos)], (u) => u.transactionId);
      const groupedSpentUtxos = hashMapGroupBy([...HashMap.values(spentUtxos)], (u) => u.transactionId);

      const transactionIds = uniqueArray([
        ...HashMap.keys(groupedNewUtxos),
        ...HashMap.keys(groupedSpentUtxos),
      ]).toSorted();

      const changes: DustStateChanges[] = transactionIds.map((txId) => {
        const received = Option.getOrElse(HashMap.get(groupedNewUtxos, txId), () => []);
        const spent = Option.getOrElse(HashMap.get(groupedSpentUtxos, txId), () => []);
        const txHash = received.at(0)?.transactionHash || spent.at(0)?.transactionHash;
        console.log(
          `Processing transaction ${txHash} with ${received.length} received and ${spent.length} spent UTXOs`,
        );
        return new DustStateChanges(
          txHash!,
          received.map(({ qdo }) => qdo),
          spent.map(({ qdo }) => qdo),
        );
      });

      updatedWallet.state.syncTime = lastBlockTimestamp;
      updatedWallet = { ...updatedWallet, state: updatedWallet.state.processTtls(lastBlockTimestamp) };

      return [updatedWallet, { changes, protocolVersion: Number(state.protocolVersion) }];
    },
  };
};

const createUtxoUpdatesFromSpend = (
  wallet: CoreWallet,
  secretKey: DustSecretKey,
  knownUtxos: Readonly<DustUtxoMap>,
  generationDtimeUpdates: ReadonlyArray<DustGenerationDtimUpdate>,
  transaction: NullifierRegularTransaction,
  dustSpend: DustSpendProcessedEvent,
): Effect.Effect<DustUtxoUpdate[], SyncWalletError> =>
  Effect.gen(function* () {
    const { nullifier, vFee, commitmentIndex, declaredTime } = dustSpend;
    const knownUtxo = Option.getOrUndefined(HashMap.get(knownUtxos, nullifier));
    const qdo = knownUtxo?.qdo ?? wallet.state.findUtxoByNullifier(nullifier);
    if (!qdo) {
      return yield* new SyncWalletError({ message: `Failed to find qdo by nullifier: ${nullifier}` });
    }
    const genInfo = knownUtxo?.genInfo ?? wallet.state.generationInfo(qdo);
    if (!genInfo) {
      return yield* new SyncWalletError({ message: `Failed to find generation info for: ${qdo.backingNight}` });
    }
    const dtimeUpdate = generationDtimeUpdates.find((upd) => upd.nightUtxoHash === genInfo.nonce);
    const updatedGenInfo = dtimeUpdate !== undefined ? { ...genInfo, dtime: dtimeUpdate.newDtime } : genInfo;
    const txMeta = { transactionId: transaction.id, transactionHash: transaction.hash, genInfo: updatedGenInfo };
    const spentUpdate: DustUtxoUpdate = { dustNullifier: nullifier, qdo, isSpent: true, ...txMeta };
    const newUtxo = successorDustUtxo(
      qdo,
      declaredTime,
      vFee,
      commitmentIndex,
      updatedGenInfo,
      secretKey,
      transaction.block.ledgerParameters.dust,
    );
    const newUtxoUpdate: DustUtxoUpdate = {
      dustNullifier: dustNullifier(newUtxo, secretKey),
      qdo: newUtxo,
      isSpent: false,
      ...txMeta,
    };
    return [spentUpdate, newUtxoUpdate];
  });

const createDustUtxoUpdates = (
  wallet: CoreWallet,
  nullifierTransactions: ReadonlyArray<DustNullifierTransactionsSubscription>,
  secretKey: DustSecretKey,
  knownUtxos: Readonly<DustUtxoMap>,
  generationDtimeUpdates: ReadonlyArray<DustGenerationDtimUpdate>,
): Effect.Effect<DustUtxoUpdate[], SyncWalletError> =>
  pipe(
    nullifierTransactions,
    Arr.filterMap(({ transaction }) =>
      transaction.__typename === 'RegularTransaction' ? Option.some(transaction) : Option.none(),
    ),
    Arr.flatMap((transaction) =>
      Arr.filterMap(transaction.dustLedgerEvents, (event) =>
        event.raw.content.tag === 'dustSpendProcessed'
          ? Option.some({ transaction, dustSpend: event.raw.content as DustSpendProcessedEvent })
          : Option.none(),
      ),
    ),
    Arr.map(({ transaction, dustSpend }) =>
      createUtxoUpdatesFromSpend(wallet, secretKey, knownUtxos, generationDtimeUpdates, transaction, dustSpend),
    ),
    Effect.all,
    Effect.map(Arr.flatten),
  );

export const makeSimulatorSyncService = (
  config: SimulatorSyncConfiguration,
): SyncService<CoreWallet, DustSecretKey, SimulatorSyncUpdate> => {
  return {
    updates: (_state: CoreWallet, secretKey: DustSecretKey, onProgress?: (progress: number) => void) => {
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
          zswapEndIndex: 1, //lastBlock.zswapEndIndex, // TODO: implement
          dustCommitmentEndIndex: 1, //lastBlock.dustCommitmentEndIndex,
          dustGenerationEndIndex: 1, //,
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
