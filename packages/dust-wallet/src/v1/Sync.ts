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
  type Array as Arr,
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
  type QualifiedDustOutput,
  type TransactionHash,
} from '@midnight-ntwrk/ledger-v8';
import {
  DustGenerationEvents,
  BlockHash,
  DustLedgerEvents,
  TransactionEvents,
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
  type TransactionEventsUpdate,
  TransactionEventsUpdateSchema,
  type WalletSyncSubscription,
  WalletSyncUpdate,
  BlockDataSchema,
  type BlockData,
  type DustGenerationDtimUpdate,
  type NewDustGeneration,
} from './SyncSchema.js';
import { type DustGenerationInfo } from './types/index.js';
import { nullifierToHex, uniqueArray, upsertArrayMap } from './Utils.js';

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

const blockCacheRef = { value: HashMap.empty<number, BlockData>() };
export const Trigger = Symbol('SyncTrigger');

export const makeEventLessSyncService =
  (trigger: Stream.Stream<typeof Trigger>) =>
  (config: DefaultSyncConfiguration): SyncService<CoreWallet, DustSecretKey, DustProjectionsUpdate> => {
    const defaultSyncService = makeDefaultSyncService(config);
    const indexerSyncService = makeIndexerSyncService(config);

    const nullifierTransactionsSubscription = (
      dustNullifiers: Arr.NonEmptyReadonlyArray<DustNullifier>,
      blockHeight: number | null,
    ): Stream.Stream<TransactionEventsUpdate, WalletError, Scope.Scope | QueryClient | SubscriptionClient> => {
      return pipe(
        indexerSyncService.subscribeDustNullifierTransactions(dustNullifiers, blockHeight),
        Stream.mapEffect((subscription) => indexerSyncService.transactionEvents(subscription.transactionHash)),
      );
    };

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

    const getEndIndexes = (
      blockData: BlockData,
    ): Effect.Effect<
      { maxCommitmentTreeIndex: number; maxGeneratingTreeIndex: number; lastBlockWithTxsTime: Date },
      WalletError
    > =>
      Effect.gen(function* () {
        if (blockData.height === 0) {
          return { maxCommitmentTreeIndex: 84, maxGeneratingTreeIndex: 84, lastBlockWithTxsTime: blockData.timestamp };
        }

        const regularTxs = blockData.transactions.filter((tx) => tx.__typename === 'RegularTransaction');

        if (regularTxs.length > 0) {
          return {
            maxCommitmentTreeIndex: Math.max(...regularTxs.map((tx) => tx.dustCommitmentEndIndex)) - 1,
            maxGeneratingTreeIndex: Math.max(...regularTxs.map((tx) => tx.dustGenerationEndIndex)) - 1,
            lastBlockWithTxsTime: blockData.timestamp,
          };
        }

        const prevBlock = blockData.height - 1;
        const cached = HashMap.get(blockCacheRef.value, prevBlock);
        if (Option.isSome(cached)) {
          return yield* getEndIndexes(cached.value);
        }

        console.log('going one block back:', prevBlock);
        const prevBlockData = yield* defaultSyncService.blockData(prevBlock);
        blockCacheRef.value = HashMap.set(blockCacheRef.value, prevBlock, prevBlockData);
        return yield* getEndIndexes(prevBlockData);
      });

    const getUnsyncedNullifiers = (newGenerations: ReadonlyArray<NewDustGeneration>, state: CoreWallet) => {
      return newGenerations
        .map((n) => n.dustNullifier)
        .concat(state.dustNullifiers.filter((n) => !n.isSpent).map((n) => n.dustNullifier));
    };

    const doSync = (
      state: CoreWallet,
      secretKey: DustSecretKey,
    ): Effect.Effect<DustProjectionsUpdate, WalletError, Scope.Scope | QueryClient | SubscriptionClient> => {
      console.log('syncing for: ', state.publicKey.addressHex);
      return Effect.gen(function* () {
        const blockData = yield* defaultSyncService.blockData();
        blockCacheRef.value = HashMap.set(blockCacheRef.value, blockData.height, blockData);
        // TODO: this will come as part of the blockData response
        // TODO: use `blockData.timestamp` instead of lastBlockWithTxsTime
        const { lastBlockWithTxsTime } = yield* getEndIndexes(blockData);
        const maxCommitmentTreeIndex = blockData.dustCommitmentEndIndex - 1;
        const maxGeneratingTreeIndex = blockData.dustGenerationEndIndex - 1;
        const lastSyncedCommitmentIndex = state.state.commitmentTreeFirstFree;

        const rawGenerations = yield* pipe(
          indexerSyncService.subscribeDustGenerations(state, maxGeneratingTreeIndex),
          Stream.runCollect,
          Effect.map(Chunk.toArray),
        );
        console.log('dust generations received', rawGenerations.length);
        const dustGenerationUpdates = DustGenerationsSyncUpdate.create(rawGenerations, secretKey, state.publicKey);

        let newNullifiers = getUnsyncedNullifiers(dustGenerationUpdates.newGenerations, state);

        // track new utxos to calculate the successor utxo when the nullifier is spent
        let newUtxos = DustUtxoMap.create(dustGenerationUpdates.newGenerations);

        let spentNullifiers = HashMap.empty<
          DustNullifier,
          {
            qdo: QualifiedDustOutput;
            transactionId: number;
            transactionHash: TransactionHash;
            genInfo: DustGenerationInfo;
          }
        >();

        while (newNullifiers.length > 0) {
          const nullifierTransactions = yield* pipe(
            nullifierTransactionsSubscription(newNullifiers as Arr.NonEmptyArray<DustNullifier>, blockData.height),
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

          for (const update of dustUtxoUpdates) {
            if (update.isSpent) {
              spentNullifiers = HashMap.set(spentNullifiers, update.dustNullifier, {
                qdo: update.qdo,
                transactionId: update.transactionId,
                transactionHash: update.transactionHash,
                genInfo: update.genInfo,
              });
              continue;
            }
            newUtxos = HashMap.set(newUtxos, update.dustNullifier, {
              qdo: update.qdo,
              transactionId: update.transactionId,
              transactionHash: update.transactionHash,
              genInfo: update.genInfo,
            });
          }

          newNullifiers = dustUtxoUpdates.filter((u) => !u.isSpent).map((u) => u.dustNullifier);
        }

        // sanity check
        if ([...newUtxos].some((u) => u[1].qdo.mtIndex < lastSyncedCommitmentIndex)) {
          return yield* Effect.fail(new OtherWalletError({ message: 'Spotted stale utxo' }));
        }

        const collapsedCommitments = yield* loadCollapsedCommitments(
          Number(lastSyncedCommitmentIndex),
          maxCommitmentTreeIndex,
          newUtxos,
        );

        return {
          dustGenerations: dustGenerationUpdates,
          spentNullifiers,
          newUtxos,
          collapsedCommitments,
          // TODO: pass the whole block and verify the roots after applying the txs
          lastBlockTime: lastBlockWithTxsTime,
          // lastBlockTime: blockData.timestamp,
        };
      });
    };

    return {
      updates: (
        state: CoreWallet,
        secretKey: DustSecretKey,
      ): Stream.Stream<DustProjectionsUpdate, WalletError, Scope.Scope> =>
        pipe(
          trigger,
          Stream.mapEffect(() => doSync(state, secretKey)),
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
    state: CoreWallet,
    endIndex: number,
  ) => Stream.Stream<DustGenerationsSubscription, WalletError, Scope.Scope | SubscriptionClient>;
  subscribeDustNullifierTransactions: (
    dustNullifiers: Arr.NonEmptyReadonlyArray<DustNullifier>,
    toBlock: number | null,
  ) => Stream.Stream<DustNullifierTransactionsSubscription, WalletError, Scope.Scope | SubscriptionClient>;
  transactionEvents: (
    txHash: TransactionHash,
  ) => Effect.Effect<TransactionEventsUpdate, WalletError, Scope.Scope | QueryClient>;
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
      state: CoreWallet,
      endIndex: number,
    ): Stream.Stream<DustGenerationsSubscription, WalletError, Scope.Scope | SubscriptionClient> {
      const { appliedIndex } = state.progress;
      const { address } = state.publicKey;

      console.log(
        'Subscribing to dust generations for address:',
        address,
        'from index:',
        appliedIndex,
        'to index:',
        endIndex,
      );

      if (endIndex < 0) {
        return Stream.empty;
      }

      return pipe(
        DustGenerationEvents.run({
          dustAddress: address,
          startIndex: Number(appliedIndex),
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
          nullifierPrefixes: [...hexedNullifiers].map((n) => n.substring(0, prefixLength)),
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
        Stream.filter((record) => HashSet.has(hexedNullifiers, record.nullifier)),
        Stream.mapError((error) => new SyncWalletError(error)),
      );
    },
    transactionEvents(
      transactionHash: TransactionHash,
    ): Effect.Effect<TransactionEventsUpdate, WalletError, Scope.Scope | QueryClient> {
      return pipe(
        TransactionEvents.run({ transactionHash }),
        Effect.catchAll((err) =>
          Effect.fail(new OtherWalletError({ message: `Encountered unexpected error: ${err.message}`, cause: err })),
        ),
        Effect.flatMap((result) => {
          const regularTransaction = result.transactions.find((tx) => tx.__typename === 'RegularTransaction');
          if (!regularTransaction) {
            throw new OtherWalletError({ message: `Unable to find a transaction by hash: ${transactionHash}` });
          }
          return pipe(
            Schema.decodeUnknownEither(TransactionEventsUpdateSchema)(regularTransaction),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          );
        }),
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
      const { dustGenerations, spentNullifiers, newUtxos, collapsedCommitments, lastBlockTime } = update;

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
      updatedWallet = CoreWallet.applySpentNullifiers(updatedWallet, [...HashMap.keys(spentNullifiers)]);

      if (dustGenerations.lastUpdateIndex !== undefined) {
        updatedWallet = CoreWallet.updateProgress(updatedWallet, {
          appliedIndex: BigInt(dustGenerations.lastUpdateIndex),
          highestRelevantWalletIndex: BigInt(dustGenerations.lastUpdateIndex),
          isConnected: true,
        });
      }

      type TransactionUtxos = HashMap.HashMap<
        number, // TransactionId
        Array<{
          qdo: QualifiedDustOutput;
          transactionId: number;
          transactionHash: TransactionHash;
        }>
      >;
      const receivedUtxos = [...HashMap.values(newUtxos)].reduce(
        (map, utxoInfo) => upsertArrayMap(map, utxoInfo.transactionId, utxoInfo),
        HashMap.empty<
          number,
          Array<{ qdo: QualifiedDustOutput; transactionId: number; transactionHash: TransactionHash }>
        >() as TransactionUtxos,
      );

      const spentUtxos = [...HashMap.values(spentNullifiers)].reduce(
        (map, utxoInfo) => upsertArrayMap(map, utxoInfo.transactionId, utxoInfo),
        HashMap.empty<
          number,
          Array<{ qdo: QualifiedDustOutput; transactionId: number; transactionHash: TransactionHash }>
        >() as TransactionUtxos,
      );

      const transactionIds = uniqueArray([...HashMap.keys(receivedUtxos), ...HashMap.keys(spentUtxos)]).toSorted();

      const changes: DustStateChanges[] = transactionIds.map((txId) => {
        const received = Option.getOrElse(
          HashMap.get(receivedUtxos, txId),
          () => [] as Array<{ qdo: QualifiedDustOutput; transactionId: number; transactionHash: TransactionHash }>,
        );
        const spent = Option.getOrElse(
          HashMap.get(spentUtxos, txId),
          () => [] as Array<{ qdo: QualifiedDustOutput; transactionId: number; transactionHash: TransactionHash }>,
        );
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

      updatedWallet.state.syncTime = lastBlockTime;
      updatedWallet = { ...updatedWallet, state: updatedWallet.state.processTtls(lastBlockTime) };

      return [updatedWallet, { changes, protocolVersion: Number(state.protocolVersion) }];
    },
  };
};

const createDustUtxoUpdates = (
  wallet: CoreWallet,
  nullifierTransactions: ReadonlyArray<TransactionEventsUpdate>,
  secretKey: DustSecretKey,
  knownUtxos: Readonly<DustUtxoMap>,
  generationDtimeUpdates: ReadonlyArray<DustGenerationDtimUpdate>,
): Effect.Effect<DustUtxoUpdate[], SyncWalletError> =>
  Effect.gen(function* () {
    const utxoUpdates: DustUtxoUpdate[] = [];

    for (const tx of nullifierTransactions) {
      const dustSpendEvents = tx.dustLedgerEvents.filter(
        (dustEvent) => dustEvent.raw.content.tag === 'dustSpendProcessed',
      );

      for (const dustSpend of dustSpendEvents) {
        const { nullifier, vFee, commitmentIndex, declaredTime } = dustSpend.raw.content as DustSpendProcessedEvent;
        const knownUtxo = Option.getOrUndefined(HashMap.get(knownUtxos, nullifier));
        const qdo = knownUtxo?.qdo ?? wallet.state.findUtxoByNullifier(nullifier);
        if (!qdo) {
          return yield* Effect.fail(new SyncWalletError({ message: `Failed to find qdo by nullifier: ${nullifier}` }));
        }
        let genInfo = knownUtxo?.genInfo ?? wallet.state.generationInfo(qdo);
        if (!genInfo) {
          return yield* Effect.fail(
            new SyncWalletError({ message: `Failed to find genInfo for: ${qdo.backingNight}` }),
          );
        }
        // apply dtime changes
        const dtimeUpdate = generationDtimeUpdates.find((up) => up.nightUtxoHash === genInfo!.nonce);
        if (dtimeUpdate) {
          genInfo = { ...genInfo, dtime: dtimeUpdate.newDtime };
        }

        utxoUpdates.push({
          dustNullifier: nullifier,
          qdo,
          isSpent: true,
          transactionId: tx.id,
          transactionHash: tx.hash,
          genInfo,
        });

        const newUtxo = successorDustUtxo(
          qdo,
          declaredTime,
          vFee,
          commitmentIndex,
          genInfo,
          secretKey,
          tx.block.ledgerParameters.dust,
        );

        utxoUpdates.push({
          dustNullifier: dustNullifier(newUtxo, secretKey),
          qdo: newUtxo,
          isSpent: false,
          transactionId: tx.id,
          transactionHash: tx.hash,
          genInfo,
        });
      }
    }

    return utxoUpdates;
  });

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
          zswapEndIndex: 1, //lastBlock.zswapEndIndex, // TODO: implement
          dustCommitmentEndIndex: 1, //lastBlock.dustCommitmentEndIndex,
          dustGenerationEndIndex: 1, //,
          transactions: [], // TODO: add txs from lastBlock.transactions
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
