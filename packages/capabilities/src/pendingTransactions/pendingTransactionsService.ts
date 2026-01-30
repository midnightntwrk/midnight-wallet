/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) 2025 Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  Clock,
  DateTime,
  DefaultServices,
  Duration,
  Effect,
  Exit,
  Iterable,
  Option,
  ParseResult,
  pipe,
  Schedule,
  Scope,
  Stream,
  SubscriptionRef,
} from 'effect';
import * as PendingTransactions from './pendingTransactions.js';
import * as rx from 'rxjs';
import { HttpQueryClient, QueryClient } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { TransactionStatus, TransactionStatusQuery } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import { EitherOps, ObservableOps } from '@midnight-ntwrk/wallet-sdk-utilities';

export type PendingTransactionsService<TTransaction> = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  state: () => rx.Observable<PendingTransactions.PendingTransactions<TTransaction>>;
  addPendingTransaction: (tx: TTransaction) => Promise<void>;
  clear: (tx: TTransaction) => Promise<void>;
};

export type IndexerClientConnection = {
  indexerHttpUrl: string;
  indexerWsUrl?: string;
};

export type DefaultPendingTransactionsServiceConfiguration = {
  indexerClientConnection: IndexerClientConnection;
};

export type InitParams<TTransaction> = {
  txTrait: PendingTransactions.TransactionTrait<TTransaction>;
  initialState?: PendingTransactions.PendingTransactions<TTransaction>;
  configuration: DefaultPendingTransactionsServiceConfiguration;
};

export class PendingTransactionsServiceImpl<TTransaction> implements PendingTransactionsService<TTransaction> {
  static init<TTransaction>(
    initParams: InitParams<TTransaction>,
  ): Promise<PendingTransactionsServiceImpl<TTransaction>> {
    return PendingTransactionsServiceImpl.initEffect(initParams).pipe(Effect.runPromise);
  }

  static restore<TTransaction>(
    data: string,
    txTrait: PendingTransactions.TransactionTrait<TTransaction>,
    configuration: DefaultPendingTransactionsServiceConfiguration,
  ): Promise<PendingTransactionsServiceImpl<TTransaction>> {
    return pipe(
      PendingTransactions.deserialize(data, txTrait),
      EitherOps.toEffect,
      Effect.andThen((state) =>
        PendingTransactionsServiceImpl.initEffect({ txTrait, initialState: state, configuration }),
      ),
      Effect.runPromise,
    );
  }

  private static initEffect<TTransaction>(
    initParams: InitParams<TTransaction>,
  ): Effect.Effect<PendingTransactionsServiceImpl<TTransaction>> {
    return Effect.gen(function* () {
      const service = new PendingTransactionsServiceEffectImpl<TTransaction>(
        initParams.txTrait,
        initParams.initialState,
      );
      const scope = yield* Scope.make();

      return new PendingTransactionsServiceImpl<TTransaction>(service, scope, initParams.configuration);
    });
  }

  #effectService: PendingTransactionsServiceEffect<TTransaction>;
  #scope: Scope.CloseableScope;
  #configuration: DefaultPendingTransactionsServiceConfiguration;

  constructor(
    effectService: PendingTransactionsServiceEffect<TTransaction>,
    scope: Scope.CloseableScope,
    configuration: DefaultPendingTransactionsServiceConfiguration,
  ) {
    this.#effectService = effectService;
    this.#scope = scope;
    this.#configuration = configuration;
  }

  addPendingTransaction(tx: TTransaction): Promise<void> {
    return this.#effectService.addPendingTransaction(tx).pipe(Effect.runPromise);
  }

  clear(tx: TTransaction): Promise<void> {
    return this.#effectService.clear(tx).pipe(Effect.runPromise);
  }

  start(): Promise<void> {
    return this.#effectService.startPolling(Stream.tick(Duration.seconds(1))).pipe(
      Effect.provide(
        HttpQueryClient.layer({
          url: this.#configuration.indexerClientConnection.indexerHttpUrl,
        }),
      ),
      Effect.provideService(Scope.Scope, this.#scope),
      Effect.provide(DefaultServices.liveServices),
      Effect.runFork,
      () => Promise.resolve(),
    );
  }

  state(): rx.Observable<PendingTransactions.PendingTransactions<TTransaction>> {
    return this.#effectService.state().pipe(ObservableOps.fromStream);
  }

  stop(): Promise<void> {
    return pipe(Scope.close(this.#scope, Exit.succeed(undefined)), Effect.runPromise);
  }
}

export type PendingTransactionsServiceEffect<TTransaction> = {
  startPolling: (ticks: Stream.Stream<unknown>) => Effect.Effect<void, Error, QueryClient | Scope.Scope | Clock.Clock>;
  state: () => Stream.Stream<PendingTransactions.PendingTransactions<TTransaction>>;
  addPendingTransaction: (tx: TTransaction) => Effect.Effect<void, never, never>;
  clear: (tx: TTransaction) => Effect.Effect<void, never, never>;
};

export class PendingTransactionsServiceEffectImpl<
  TTransaction,
> implements PendingTransactionsServiceEffect<TTransaction> {
  #state: SubscriptionRef.SubscriptionRef<PendingTransactions.PendingTransactions<TTransaction>>;
  #txTrait: PendingTransactions.TransactionTrait<TTransaction>;

  static restore<TTransaction>(
    data: string,
    txTrait: PendingTransactions.TransactionTrait<TTransaction>,
  ): Effect.Effect<PendingTransactionsServiceEffectImpl<TTransaction>, ParseResult.ParseError> {
    return pipe(
      data,
      (data) => PendingTransactions.deserialize<TTransaction>(data, txTrait),
      EitherOps.toEffect,
      Effect.map((state) => new PendingTransactionsServiceEffectImpl<TTransaction>(txTrait, state)),
    );
  }

  constructor(
    txTrait: PendingTransactions.TransactionTrait<TTransaction>,
    initialState?: PendingTransactions.PendingTransactions<TTransaction>,
  ) {
    this.#txTrait = txTrait;
    this.#state = SubscriptionRef.make<PendingTransactions.PendingTransactions<TTransaction>>(
      initialState ?? PendingTransactions.empty(),
    ).pipe(Effect.runSync); // Should not be here, but otherwise initialization would be too involved
  }

  state(): Stream.Stream<PendingTransactions.PendingTransactions<TTransaction>> {
    return Stream.concat(Stream.fromEffect(SubscriptionRef.get(this.#state)), this.#state.changes);
  }

  startPolling(ticks: Stream.Stream<unknown>): Effect.Effect<void, Error, QueryClient | Scope.Scope> {
    return ticks.pipe(
      Stream.mapEffect(() => SubscriptionRef.get(this.#state)),
      Stream.mapConcat(PendingTransactions.allPending),
      Stream.mapConcatEffect((item) => {
        return Effect.gen(this, function* () {
          const now: DateTime.Utc = yield* DateTime.now;
          const result = yield* this.queryForStatus(item.tx);

          return Option.match(result, {
            onSome: (status) => [{ ...item, result: status }],
            onNone: () => {
              const failedResult: PendingTransactions.FailedTransactionResult = {
                status: 'FAILURE',
                segments: [],
              };
              return this.#txTrait.hasTTLExpired(item.tx, item.creationTime, now)
                ? [{ ...item, result: failedResult }]
                : [];
            },
          });
        });
      }),
      Stream.retry(
        pipe(
          Schedule.exponential(Duration.millis(1)),
          Schedule.jitteredWith({ min: 0.1, max: 1.2 }),
          Schedule.resetAfter(Duration.minutes(5)),
        ),
      ),
      Stream.catchAll((error) => {
        return Stream.execute(Effect.logWarning(error, 'Caught error in PendingTransactionsService'));
      }),
      Stream.runForEachScoped(
        (item: { tx: TTransaction; result: PendingTransactions.TransactionResult }): Effect.Effect<void> => {
          return this.saveResult(item.tx, item.result);
        },
      ),
    );
  }

  addPendingTransaction(tx: TTransaction): Effect.Effect<void> {
    return SubscriptionRef.updateEffect(this.#state, (state) => {
      return DateTime.now.pipe(
        Effect.andThen((now) => PendingTransactions.addPendingTransaction(state, tx, now, this.#txTrait)),
      );
    });
  }

  clear(tx: TTransaction): Effect.Effect<void> {
    return SubscriptionRef.update(this.#state, (state) => {
      return PendingTransactions.clear(state, tx, this.#txTrait);
    });
  }

  private saveResult(tx: TTransaction, result: PendingTransactions.TransactionResult): Effect.Effect<void> {
    switch (result.status) {
      case 'SUCCESS':
        return this.clear(tx);
      case 'FAILURE':
      case 'PARTIAL_SUCCESS':
        return SubscriptionRef.update(this.#state, (state) => {
          return PendingTransactions.saveResult(state, tx, result, this.#txTrait);
        });
    }
  }

  private queryForStatus(
    tx: TTransaction,
  ): Effect.Effect<Option.Option<PendingTransactions.TransactionResult>, Error, QueryClient> {
    return Effect.gen(this, function* () {
      const statusQuery = yield* TransactionStatus;
      const result = yield* statusQuery({ transactionId: this.#txTrait.firstId(tx) }).pipe(
        Effect.catchAll((error) => {
          const fallback: TransactionStatusQuery = { transactions: [] };
          return pipe(
            Effect.logWarning(error, 'Observed error in PendingTransactionsService, retrying'),
            Effect.as(fallback),
          );
        }),
      );

      return pipe(
        result.transactions,
        Iterable.filterMap((res): Option.Option<PendingTransactions.TransactionResult> => {
          if (res.__typename == 'SystemTransaction') {
            return Option.none();
          }

          if (
            res.transactionResult.status != 'SUCCESS' &&
            res.transactionResult.status != 'FAILURE' &&
            res.transactionResult.status != 'PARTIAL_SUCCESS'
          ) {
            return Option.none();
          }

          if (this.#txTrait.areAllTxIdsIncluded(tx, res.identifiers)) {
            return Option.some<PendingTransactions.TransactionResult>({
              status: res.transactionResult.status,
              segments: res.transactionResult.segments ?? [],
            });
          } else {
            return Option.none();
          }
        }),
        Iterable.head,
      );
    });
  }
}
