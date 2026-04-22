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
import { Effect, Either, Layer, pipe, Schema, Scope, Stream, Duration, Chunk, Schedule, Encoding } from 'effect';
import {
  DustSecretKey,
  LedgerParameters,
  dustNullifier,
  DustNullifier,
  QualifiedDustOutput,
  DustGenerationInfo,
  dustNonce,
} from '@midnight-ntwrk/ledger-v8';
import {
  DustGenerationEvents,
  BlockHash,
  DustLedgerEvents,
  TransactionEvents,
  DustNullifierTransactions,
} from '@midnight-ntwrk/wallet-sdk-indexer-client';
import {
  WsSubscriptionClient,
  HttpQueryClient,
  ConnectionHelper,
  SubscriptionClient,
  QueryClient,
} from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { DateOps, EitherOps, LedgerOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { URLError, WsURL } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { OtherWalletError, SyncWalletError, WalletError } from './WalletError.js';
import { Simulator, SimulatorState } from './Simulator.js';
import { CoreWallet, DustGenerationWithNullifierUpdate, DustNullifierUpdate } from './CoreWallet.js';
import { NetworkId } from './types/ledger.js';
import {
  DustGenerationsSubscription,
  DustGenerationsSubscriptionSchema,
  DustGenerationsSyncUpdate,
  DustNullifierTransactionsSubscription,
  DustNullifierTransactionSubscriptionSchema,
  DustSpendProcessedEvent,
  SyncEventsUpdateSchema,
  TransactionEventsUpdate,
  TransactionEventsUpdateSchema,
  WalletSyncSubscription,
  WalletSyncUpdate,
} from './SyncSchema.js';

export interface SyncService<TState, TStartAux, TUpdate> {
  updates: (state: TState, auxData: TStartAux) => Stream.Stream<TUpdate, WalletError, Scope.Scope>;
  blockData: () => Effect.Effect<BlockData, WalletError>;
}

// TODO: use schema instead
export interface BlockData {
  hash: string;
  height: number;
  ledgerParameters: LedgerParameters;
  timestamp: Date;
}

export interface SyncCapability<TState, TUpdate> {
  applyUpdate: (state: TState, update: TUpdate) => TState;
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
        Effect.flatMap((blockData) => {
          if (!blockData) {
            throw new OtherWalletError({ message: 'Unable to fetch block data' });
          }
          // TODO: convert to schema
          return LedgerOps.ledgerTry(() => ({
            hash: blockData.hash,
            height: blockData.height,
            ledgerParameters: LedgerParameters.deserialize(Buffer.from(blockData.ledgerParameters, 'hex')),
            timestamp: new Date(blockData.timestamp),
          }));
        }),
      );
    },
  };
};

export const makeDustGenerationsSyncService = (
  config: DefaultSyncConfiguration,
): SyncService<CoreWallet, DustSecretKey, DustGenerationsSyncUpdate> => {
  const defaultSyncService = makeDefaultSyncService(config);
  const indexerSyncService = makeIndexerSyncService(config);

  const nullifierTransactionsSubscription = (
    dustNullifiers: DustNullifier[],
    blockHeight: number | null,
  ): Stream.Stream<TransactionEventsUpdate, WalletError, Scope.Scope | QueryClient | SubscriptionClient> => {
    return pipe(
      indexerSyncService.subscribeDustNullifierTransactions(dustNullifiers, blockHeight),
      Stream.mapEffect((subscription) => indexerSyncService.transactionEvents(subscription.transactionId)),
    );
  };

  return {
    updates: (
      state: CoreWallet,
      secretKey: DustSecretKey,
    ): Stream.Stream<DustGenerationsSyncUpdate, WalletError, Scope.Scope> => {
      return pipe(
        Effect.gen(function* () {
          const blockData = yield* defaultSyncService.blockData();
          const rawGenerations = yield* pipe(
            indexerSyncService.subscribeDustGenerations(state, blockData.height),
            Stream.runCollect,
            Effect.map(Chunk.toArray),
          );
          const generations = DustGenerationsSyncUpdate.create(rawGenerations, secretKey);
          let updatedWallet = applyDustGenerationsUpdate(state, generations);

          let newNullifiers = updatedWallet.dustNullifiers.filter((n) => !n.isSynced).map((n) => n.dustNullifier);

          while (newNullifiers.length > 0) {
            const nullifierTransactions = yield* pipe(
              nullifierTransactionsSubscription(newNullifiers, blockData.height),
              Stream.runCollect,
              Effect.map(Chunk.toArray),
            );
            [updatedWallet, newNullifiers] = yield* applyNullifierTransactionsUpdate(
              updatedWallet,
              nullifierTransactions,
              secretKey,
            );
          }
        }),
        Stream.unwrap,
        Stream.provideSomeLayer(indexerSyncService.connectionLayer()),
      );
    },
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
    latestBlock: number,
  ) => Stream.Stream<DustGenerationsSubscription, WalletError, Scope.Scope | SubscriptionClient>;
  subscribeDustNullifierTransactions: (
    dustNullifiers: DustNullifier[],
    toBlock: number | null,
  ) => Stream.Stream<DustNullifierTransactionsSubscription, WalletError, Scope.Scope | SubscriptionClient>;
  transactionEvents: (txId: number) => Effect.Effect<TransactionEventsUpdate, WalletError, Scope.Scope | QueryClient>;
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
      latestBlock: number,
    ): Stream.Stream<DustGenerationsSubscription, WalletError, Scope.Scope | SubscriptionClient> {
      const { appliedIndex } = state.progress;
      const { publicKey } = state.publicKey;

      return pipe(
        DustGenerationEvents.run({
          dustAddress: publicKey.toString(16),
          startIndex: Number(appliedIndex),
          endIndex: latestBlock,
        }),
        Stream.mapEffect((subscription) =>
          pipe(
            Schema.decodeUnknownEither(DustGenerationsSubscriptionSchema)(subscription.dustGenerations),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          ),
        ),
        Stream.mapError((error) => new SyncWalletError(error)),
      );
    },
    subscribeDustNullifierTransactions(
      dustNullifiers: DustNullifier[],
      toBlock: number | null,
    ): Stream.Stream<DustNullifierTransactionsSubscription, WalletError, Scope.Scope | SubscriptionClient> {
      const fullNullifiers = new Set(dustNullifiers.map((n) => n.toString()));
      return pipe(
        DustNullifierTransactions.run({
          nullifierPrefixes: [...fullNullifiers].map((n) => n.substring(0, n.length / 2)),
          fromBlock: 0,
          toBlock,
        }),
        Stream.mapEffect((subscription) =>
          pipe(
            Schema.decodeUnknownEither(DustNullifierTransactionSubscriptionSchema)(
              subscription.dustNullifierTransactions,
            ),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          ),
        ),
        Stream.filter((record) => fullNullifiers.has(record.nullifier)),
        Stream.mapError((error) => new SyncWalletError(error)),
      );
    },
    transactionEvents(txId: number): Effect.Effect<TransactionEventsUpdate, WalletError, Scope.Scope | QueryClient> {
      return pipe(
        TransactionEvents.run({ transactionId: Encoding.encodeHex(txId.toString()) }),
        Effect.flatMap((result) => {
          const nonSystemTransactions = result.transactions.filter((tx) => tx.__typename === 'RegularTransaction');
          if (!nonSystemTransactions.length) {
            throw new OtherWalletError({ message: `Unable to find a transaction by id: ${txId}` });
          }
          return pipe(
            Schema.decodeUnknownEither(TransactionEventsUpdateSchema)(nonSystemTransactions[0]),
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

export const makeDefaultSyncCapability = (): SyncCapability<CoreWallet, WalletSyncUpdate> => {
  return {
    applyUpdate(state: CoreWallet, wrappedUpdate: WalletSyncUpdate): CoreWallet {
      const { updates, secretKey } = wrappedUpdate;

      // Nothing to update yet
      if (updates.length === 0) {
        return state;
      }

      const lastUpdate = updates.at(-1)!;
      const nextIndex = BigInt(lastUpdate.id);
      const highestRelevantWalletIndex = BigInt(lastUpdate.maxId);

      // in case the nextIndex is less than or equal to the current appliedIndex
      // just update highestRelevantWalletIndex
      if (nextIndex <= state.progress.appliedIndex) {
        return CoreWallet.updateProgress(state, { highestRelevantWalletIndex, isConnected: true });
      }

      const events = updates.map((u) => u.raw).filter((event) => event !== null);

      return CoreWallet.updateProgress(CoreWallet.applyEvents(state, secretKey, events, wrappedUpdate.timestamp), {
        appliedIndex: nextIndex,
        highestRelevantWalletIndex,
        isConnected: true,
      });
    },
  };
};

export const applyDustGenerationsUpdate = (
  wallet: CoreWallet,
  wrappedUpdate: DustGenerationsSyncUpdate,
): CoreWallet => {
  const publicKey = Encoding.encodeHex(wallet.publicKey.publicKey.toString());
  const { updates, secretKey } = wrappedUpdate;

  // Nothing to update yet
  if (updates.length === 0) {
    return wallet;
  }

  const lastUpdateIndex = updates
    .filter((u) => u.type === 'DustGenerationsProgress')
    .map((u) => u.highestIndex)
    .toSorted()
    .at(-1);

  console.log(`Applying ${updates.length} dust generation updates for wallet ${publicKey}`, updates);
  const dustGenTreeUpdates = updates
    .map((u) => u.collapsedMerkleTree)
    .filter((u) => u !== undefined)
    .toSorted((u1, u2) => u1.startIndex - u2.startIndex);

  const generationUpdates = updates
    .filter((u) => u.type === 'DustGenerationsItem')
    .filter((u) => u.owner === publicKey)
    .toSorted((u1, u2) => u1.generationMtIndex - u2.generationMtIndex)
    .map((u) => ({
      genInfo: {
        value: BigInt(u.value),
        owner: wallet.publicKey.publicKey,
        nonce: u.backingNight,
        dtime: undefined,
      } as DustGenerationInfo,
      generationIndex: u.generationMtIndex,
      qdo: {
        initialValue: BigInt(u.initialValue),
        owner: wallet.publicKey.publicKey,
        nonce: dustNonce(u.backingNight, 0n, secretKey),
        seq: 0,
        ctime: u.ctime,
        backingNight: u.backingNight,
        mtIndex: BigInt(u.commitmentMtIndex),
      } as QualifiedDustOutput,
    }));

  const generationUpdatesWithNullifiers = generationUpdates.map(
    ({ genInfo, generationIndex, qdo }) =>
      ({
        dustNullifier: dustNullifier(qdo, secretKey),
        genInfo,
        generationIndex,
        qdo,
        isSynced: false,
      }) as DustGenerationWithNullifierUpdate,
  );

  const updatedWallet = CoreWallet.applyDustGenerations(wallet, dustGenTreeUpdates, generationUpdatesWithNullifiers);

  if (lastUpdateIndex !== undefined) {
    return CoreWallet.updateProgress(updatedWallet, {
      appliedIndex: BigInt(lastUpdateIndex),
      highestRelevantWalletIndex: BigInt(lastUpdateIndex),
      isConnected: true,
    });
  }

  return updatedWallet;
};

export const applyNullifierTransactionsUpdate = (
  wallet: CoreWallet,
  nullifierTransactions: TransactionEventsUpdate[],
  secretKey: DustSecretKey,
): Effect.Effect<[CoreWallet, DustNullifier[]], SyncWalletError> =>
  Effect.gen(function* () {
    const newNullifiers: DustNullifier[] = [];
    const nullifierUpdates: DustNullifierUpdate[] = [];

    for (const tx of nullifierTransactions) {
      const dustSpends = tx.dustLedgerEvents.filter((dustEvent) => dustEvent.raw.content.tag === 'dustSpendProcessed');

      for (const dustSpend of dustSpends) {
        const { nullifier, vFee, commitmentIndex, blockTime } = dustSpend.raw.content as DustSpendProcessedEvent;
        const qdo = wallet.state.findUtxoByNullifier(nullifier);
        if (!qdo) {
          return yield* Effect.fail(new SyncWalletError({ message: `Failed to find qdo by nullifier: ${nullifier}` }));
        }

        // TODO: update old qdo's pendingUntil field
        nullifierUpdates.push({
          dustNullifier: nullifier,
          qdo,
          isSynced: true,
        });

        const newUtxo = wallet.state.successorUtxo(qdo, blockTime, vFee, commitmentIndex, secretKey);
        const newDustNullifier = dustNullifier(newUtxo, secretKey);

        newNullifiers.push(newDustNullifier);
        nullifierUpdates.push({
          dustNullifier: newDustNullifier,
          qdo: newUtxo,
          isSynced: false,
        });
      }
    }

    return [CoreWallet.applyDustNullifiers(wallet, nullifierUpdates), newNullifiers];
  });

export const makeSimulatorSyncService = (
  config: SimulatorSyncConfiguration,
): SyncService<CoreWallet, DustSecretKey, SimulatorSyncUpdate> => {
  return {
    updates: (_state: CoreWallet, secretKey: DustSecretKey) =>
      config.simulator.state$.pipe(Stream.map((state) => ({ update: state, secretKey }))),
    blockData: (): Effect.Effect<BlockData> => {
      return Effect.gen(function* () {
        const state = yield* config.simulator.getLatestState();
        const timestamp = DateOps.secondsToDate(state.lastTxNumber);
        return {
          hash: yield* Simulator.blockHash(timestamp),
          height: Number(state.lastTxNumber),
          ledgerParameters: state.ledger.parameters,
          timestamp,
        };
      });
    },
  };
};

export const makeSimulatorSyncCapability = (): SyncCapability<CoreWallet, SimulatorSyncUpdate> => ({
  applyUpdate: (state: CoreWallet, update: SimulatorSyncUpdate) =>
    CoreWallet.updateProgress(
      CoreWallet.applyEvents(
        state,
        update.secretKey,
        update.update.lastTxResult?.events || [],
        DateOps.secondsToDate(update.update.lastTxNumber),
      ),
      { appliedIndex: update.update.lastTxNumber },
    ),
});
