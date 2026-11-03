/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) Midnight Foundation
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

import { type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { TransactionStatus } from '@midnightntwrk/wallet-sdk-indexer-client';
import { HttpQueryClient, type QueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { EitherOps, ObservableOps } from '@midnightntwrk/wallet-sdk-utilities';
import {
  Array as Arr,
  Clock,
  DateTime,
  DefaultServices,
  Duration,
  Effect,
  Exit,
  Option,
  type ParseResult,
  pipe,
  Scope,
  Stream,
  SubscriptionRef,
} from 'effect';
import type * as rx from 'rxjs';
import * as Lifecycle from './lifecycle.js';
import {
  type FailedTransactionResult,
  type TransactionTrait,
  traitForVersion,
  type VersionedTransactionTrait,
} from './transactionTraits.js';

/**
 * Where the indexer the default service polls is.
 *
 * @example
 *   const connection: IndexerClientConnection = { indexerHttpUrl: 'http://localhost:8088/api/v3/graphql' };
 */
export type IndexerClientConnection = {
  /** The indexer's GraphQL HTTP endpoint, which the poller asks about each live transaction. */
  indexerHttpUrl: string;
  /** The indexer's GraphQL WebSocket endpoint. The lifecycle service does not use it; other services do. */
  indexerWsUrl?: string;
};

/**
 * What the default service is built from.
 *
 * @example
 *   const configuration: DefaultTransactionLifecycleServiceConfiguration = {
 *     indexerClientConnection: { indexerHttpUrl },
 *   };
 */
export type DefaultTransactionLifecycleServiceConfiguration = {
  /** The indexer the service polls for what the chain made of each live transaction. */
  indexerClientConnection: IndexerClientConnection;
};

/**
 * What the chain made of a transaction it included: applied whole (`SUCCESS`), or failed in some (`PARTIAL_SUCCESS`) or
 * all (`FAILURE`) of its segments, with the segments it reported.
 */
export type InclusionVerdict = Readonly<{ status: 'SUCCESS' }> | FailedTransactionResult;

/**
 * Holds one lifecycle record per transaction and moves it as the facade and the chain report events. The Effect form of
 * the service; {@link TransactionLifecycleService} is the Promise form the facade drives.
 *
 * @remarks
 *   Every move is a pure transition in `lifecycle.ts` applied to the records in one ref, so a move that does not apply to
 *   a record's state leaves the records as they were. No move frees a coin: each wallet's own sweep and the facade's
 *   release-on-failure do that (ADR 0011).
 */
export type TransactionLifecycleServiceEffect<TTransaction> = {
  /**
   * Polls the indexer and sweeps once per tick. Each tick asks the indexer about every live record that holds its
   * transaction, then ends the records whose TTL has passed, publishes those ends, and drops every final record whose
   * TTL has passed.
   *
   * @param ticks When to poll. The default service ticks once a second.
   * @returns An effect that runs until the provided scope closes.
   */
  startPolling: (ticks: Stream.Stream<unknown>) => Effect.Effect<void, Error, QueryClient | Scope.Scope>;
  /**
   * The records, now and each time they move.
   *
   * @returns A stream that starts with the records as they stand.
   */
  state: () => Stream.Stream<Lifecycle.TransactionLifecycle<TTransaction>>;
  /**
   * Records a transaction as balanced, at the clock's time.
   *
   * @param facts The balanced transaction, with its proofs erased, and what the record keeps of it.
   * @returns An effect that applies the move.
   */
  balanced: (facts: Lifecycle.TransactionFacts<TTransaction>) => Effect.Effect<void>;
  /**
   * Records a transaction as finalized, at the clock's time, folding every record it covers into one.
   *
   * @param facts The finalized transaction and what the record keeps of it.
   * @returns An effect that applies the move.
   */
  finalized: (facts: Lifecycle.TransactionFacts<TTransaction>) => Effect.Effect<void>;
  /**
   * Records a transaction as submitted, at the clock's time, which becomes its submission time.
   *
   * @param facts The submitted transaction and what the record keeps of it.
   * @returns An effect that applies the move.
   */
  submitted: (facts: Lifecycle.TransactionFacts<TTransaction>) => Effect.Effect<void>;
  /**
   * Records that the transaction holding any of `identifiers` was reverted: its coins were given back, so no chain will
   * be asked to include it.
   *
   * @param identifiers The reverted transaction's identifiers.
   * @returns An effect that applies the move.
   */
  reverted: (identifiers: readonly string[]) => Effect.Effect<void>;
  /**
   * Gives up on every live transaction built for an epoch the chain has left by `chainNow`. A record whose version was
   * never known is left as it was.
   *
   * @param chainNow The protocol version the chain has reached.
   * @returns An effect that applies the move.
   */
  orphanBeyond: (chainNow: ProtocolVersion.ProtocolVersion) => Effect.Effect<void>;
  /**
   * Records that a block included the transaction holding any of `identifiers`, with the chain's `verdict`. A success
   * confirms it; a failure or partial success rejects a finalized or submitted record with the verdict.
   *
   * @param identifiers The included transaction's identifiers.
   * @param verdict What the chain made of it.
   * @returns An effect that applies the move.
   */
  included: (identifiers: readonly string[], verdict: InclusionVerdict) => Effect.Effect<void>;
  /**
   * The records as they stand, written in the stored format with the traits the service reads them with.
   *
   * @returns An effect that gives the store, in the current format version.
   */
  serializeState: () => Effect.Effect<string>;
};

/**
 * The lifecycle records in a ref, moved by the pure transitions in `lifecycle.ts` with the clock's time.
 *
 * @example
 *   const service = new TransactionLifecycleServiceEffectImpl(traits);
 *   yield * service.balanced({ tx: erased, identifiers, intentHashes, inputs, ttl, protocolVersion });
 */
export class TransactionLifecycleServiceEffectImpl<
  TTransaction,
> implements TransactionLifecycleServiceEffect<TTransaction> {
  #state: SubscriptionRef.SubscriptionRef<Lifecycle.TransactionLifecycle<TTransaction>>;
  #txTraits: VersionedTransactionTrait<TTransaction>;

  /**
   * Builds a service holding the records a previous one stored.
   *
   * @example
   *   const service = yield * TransactionLifecycleServiceEffectImpl.restore(stored, traits);
   *
   * @param data What `Lifecycle.serialize` wrote.
   * @param txTraits The traits each record's transaction is read with, chosen by its version.
   * @returns The service, or why the payload could not be read.
   */
  static restore<TTransaction>(
    data: string,
    txTraits: VersionedTransactionTrait<TTransaction>,
  ): Effect.Effect<TransactionLifecycleServiceEffectImpl<TTransaction>, ParseResult.ParseError> {
    return pipe(
      Lifecycle.deserialize(data, txTraits),
      EitherOps.toEffect,
      Effect.map((state) => new TransactionLifecycleServiceEffectImpl<TTransaction>(txTraits, state)),
    );
  }

  /**
   * Builds a service, empty or holding `initialState`.
   *
   * @param txTraits The trait each record's transaction is read with, chosen by the version it was built for.
   * @param initialState The records to begin with; none when left out.
   */
  constructor(
    txTraits: VersionedTransactionTrait<TTransaction>,
    initialState?: Lifecycle.TransactionLifecycle<TTransaction>,
  ) {
    this.#txTraits = txTraits;
    // Built synchronously so the service can be constructed outside an Effect, as the facade does.
    this.#state = SubscriptionRef.make(initialState ?? Lifecycle.empty<TTransaction>()).pipe(Effect.runSync);
  }

  /**
   * The records, now and each time they move.
   *
   * @remarks
   *   Every write publishes, whether or not it moved anything, so consecutive identical values are dropped. A transition
   *   that moves nothing returns the very state it was given, so comparing by identity never hides a real move.
   * @returns A stream that starts with the records as they stand.
   */
  state(): Stream.Stream<Lifecycle.TransactionLifecycle<TTransaction>> {
    return Stream.concat(Stream.fromEffect(SubscriptionRef.get(this.#state)), this.#state.changes).pipe(
      Stream.changesWith((a, b) => a === b),
    );
  }

  /**
   * Polls the indexer and sweeps once per tick.
   *
   * @remarks
   *   Each tick asks the indexer first and sweeps after, so an inclusion found on the tick a TTL passes is recorded
   *   before the TTL could end the record: the inclusion happened within the TTL.
   *
   *   The ticks are drained within the provided scope, so closing that scope stops the poller.
   * @param ticks When to poll.
   * @returns An effect that runs until the provided scope closes.
   */
  startPolling(ticks: Stream.Stream<unknown>): Effect.Effect<void, Error, QueryClient | Scope.Scope> {
    return ticks.pipe(Stream.runForEachScoped(() => pipe(this.poll(), Effect.andThen(this.sweep()))));
  }

  /**
   * Records a transaction as balanced, at the clock's time. See `Lifecycle.balanced` for which records it replaces.
   *
   * @param facts The balanced transaction, with its proofs erased, and what the record keeps of it.
   * @returns An effect that applies the move.
   */
  balanced(facts: Lifecycle.TransactionFacts<TTransaction>): Effect.Effect<void> {
    return this.moveNow((state, now) => Lifecycle.balanced(state, facts, now));
  }

  /**
   * Records a transaction as finalized, at the clock's time. See `Lifecycle.finalized` for which records it folds.
   *
   * @param facts The finalized transaction and what the record keeps of it.
   * @returns An effect that applies the move.
   */
  finalized(facts: Lifecycle.TransactionFacts<TTransaction>): Effect.Effect<void> {
    return this.moveNow((state, now) => Lifecycle.finalized(state, facts, now));
  }

  /**
   * Records a transaction as submitted, at the clock's time, which becomes its submission time.
   *
   * @param facts The submitted transaction and what the record keeps of it.
   * @returns An effect that applies the move.
   */
  submitted(facts: Lifecycle.TransactionFacts<TTransaction>): Effect.Effect<void> {
    return this.moveNow((state, now) => Lifecycle.submitted(state, facts, now));
  }

  /**
   * Records that the transaction holding any of `identifiers` was reverted.
   *
   * @param identifiers The reverted transaction's identifiers.
   * @returns An effect that applies the move.
   */
  reverted(identifiers: readonly string[]): Effect.Effect<void> {
    return SubscriptionRef.update(this.#state, (state) => Lifecycle.reverted(state, identifiers));
  }

  /**
   * Gives up on every live transaction built for an epoch the chain has left by `chainNow`.
   *
   * @param chainNow The protocol version the chain has reached.
   * @returns An effect that applies the move.
   */
  orphanBeyond(chainNow: ProtocolVersion.ProtocolVersion): Effect.Effect<void> {
    return SubscriptionRef.update(this.#state, (state) => Lifecycle.orphanBeyond(state, this.#txTraits, chainNow));
  }

  /**
   * Records that a block included the transaction holding any of `identifiers`: confirmed on a success, rejected with
   * the verdict on a failure or partial success.
   *
   * @param identifiers The included transaction's identifiers.
   * @param verdict What the chain made of it.
   * @returns An effect that applies the move.
   */
  included(identifiers: readonly string[], verdict: InclusionVerdict): Effect.Effect<void> {
    return SubscriptionRef.update(this.#state, (state) =>
      verdict.status === 'SUCCESS'
        ? Lifecycle.confirmed(state, identifiers)
        : Lifecycle.rejected(state, identifiers, verdict),
    );
  }

  /**
   * The records as they stand, written in the stored format with the traits the service was built with.
   *
   * @example
   *   const stored = yield * service.serializeState();
   *
   * @returns An effect that gives the store, in the current format version.
   */
  serializeState(): Effect.Effect<string> {
    return pipe(
      SubscriptionRef.get(this.#state),
      Effect.map((state) => Lifecycle.serialize(state, this.#txTraits)),
    );
  }

  /**
   * Ends what has passed its TTL, then drops it, as two writes: a record that ends because its TTL passed is due to be
   * dropped at once, so publishing between them is the only way a caller ever sees that end.
   */
  private sweep(): Effect.Effect<void> {
    return pipe(
      this.moveNow((state, now) => Lifecycle.expire(state, now)),
      Effect.andThen(this.moveNow((state, now) => Lifecycle.dropFinished(state, now))),
    );
  }

  /**
   * Asks the indexer about every live record that holds its transaction, whichever live state it is in, so a
   * transaction submitted outside the facade is confirmed too. A record without its transaction has nothing to ask by.
   */
  private poll(): Effect.Effect<void, never, QueryClient> {
    return pipe(
      SubscriptionRef.get(this.#state),
      Effect.map((state) =>
        Arr.filterMap(state.records, (record) =>
          Lifecycle.isLive(record)
            ? Option.all({ tx: record.tx, trait: traitForVersion(this.#txTraits, record.protocolVersion) }).pipe(
                Option.map((asked) => ({ ...asked, identifiers: record.identifiers })),
              )
            : Option.none(),
        ),
      ),
      Effect.flatMap((asked) =>
        Effect.forEach(asked, ({ tx, trait, identifiers }) =>
          pipe(
            verdictOf(tx, trait),
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.void,
                onSome: (verdict) => this.included(identifiers, verdict),
              }),
            ),
          ),
        ),
      ),
      Effect.asVoid,
    );
  }

  private moveNow(
    move: (
      state: Lifecycle.TransactionLifecycle<TTransaction>,
      now: DateTime.Utc,
    ) => Lifecycle.TransactionLifecycle<TTransaction>,
  ): Effect.Effect<void> {
    return SubscriptionRef.updateEffect(this.#state, (state) => Effect.map(DateTime.now, (now) => move(state, now)));
  }
}

/**
 * What the indexer reports for `tx`: the result of a regular transaction carrying every one of its identifiers, or
 * nothing while it has none. A query that fails reports nothing, so the next tick asks again.
 */
const verdictOf = <TTransaction>(
  tx: TTransaction,
  trait: TransactionTrait<TTransaction>,
): Effect.Effect<Option.Option<InclusionVerdict>, never, QueryClient> =>
  pipe(
    TransactionStatus,
    Effect.flatMap((query) => query({ transactionId: trait.firstId(tx) })),
    Effect.map((result) =>
      Arr.findFirst(result.transactions, (reported) =>
        // Only a regular transaction carries the identifiers and result this needs, and the wallet only submits
        // regular ones; every other variant, including ones a later schema adds, is ignored.
        reported.__typename === 'RegularTransaction' && trait.areAllTxIdsIncluded(tx, reported.identifiers)
          ? verdictFrom(reported.transactionResult)
          : Option.none(),
      ),
    ),
    Effect.catchAll((error) =>
      pipe(
        Effect.logWarning(error, 'Could not ask the indexer about a transaction; asking again next tick'),
        Effect.as(Option.none<InclusionVerdict>()),
      ),
    ),
  );

/** A final result as a verdict, segments stripped to what the chain decided; any other status is no verdict yet. */
const verdictFrom = (result: {
  readonly status: string;
  readonly segments?: ReadonlyArray<{ readonly id: number; readonly success: boolean }> | null;
}): Option.Option<InclusionVerdict> => {
  const segments = (result.segments ?? []).map(({ id, success }) => ({ id, success }));
  return result.status === 'SUCCESS'
    ? Option.some({ status: 'SUCCESS' })
    : result.status === 'FAILURE' || result.status === 'PARTIAL_SUCCESS'
      ? Option.some({ status: result.status, segments })
      : Option.none();
};

/**
 * The {@link TransactionLifecycleServiceEffect} as the facade drives it: promises in, an observable out.
 *
 * @remarks
 *   A custom service passed through the facade's `InitParams.transactionLifecycleService` must implement every member,
 *   `serializeState` included, so an application can save the store whichever service holds it.
 * @example
 *   const service = await TransactionLifecycleServiceImpl.init({ txTraits, configuration });
 *   await service.start();
 *   service.state().subscribe((lifecycle) => console.log(lifecycle.records.length));
 *   await service.stop();
 */
export type TransactionLifecycleService<TTransaction> = {
  /**
   * Starts polling the indexer and sweeping records whose TTL has passed, in the background.
   *
   * @returns Resolves once polling has started.
   */
  start: () => Promise<void>;
  /**
   * Stops polling. No indexer query and no sweep runs after it resolves.
   *
   * @returns Resolves once polling has stopped.
   */
  stop: () => Promise<void>;
  /**
   * The records, now and each time they move.
   *
   * @returns An observable that starts with the records as they stand.
   */
  state: () => rx.Observable<Lifecycle.TransactionLifecycle<TTransaction>>;
  /**
   * Records a transaction as balanced, at the service's clock time.
   *
   * @param facts The balanced transaction, with its proofs erased, and what the record keeps of it.
   * @returns Resolves once the move is applied.
   */
  balanced: (facts: Lifecycle.TransactionFacts<TTransaction>) => Promise<void>;
  /**
   * Records a transaction as finalized, at the service's clock time, folding every record it covers into one.
   *
   * @param facts The finalized transaction and what the record keeps of it.
   * @returns Resolves once the move is applied.
   */
  finalized: (facts: Lifecycle.TransactionFacts<TTransaction>) => Promise<void>;
  /**
   * Records a transaction as submitted, at the service's clock time, which becomes its submission time.
   *
   * @param facts The submitted transaction and what the record keeps of it.
   * @returns Resolves once the move is applied.
   */
  submitted: (facts: Lifecycle.TransactionFacts<TTransaction>) => Promise<void>;
  /**
   * Records that the transaction holding any of `identifiers` was reverted.
   *
   * @param identifiers The reverted transaction's identifiers.
   * @returns Resolves once the move is applied.
   */
  reverted: (identifiers: readonly string[]) => Promise<void>;
  /**
   * Gives up on every live transaction built for an epoch the chain has left by `chainNow`.
   *
   * @param chainNow The protocol version the chain has reached.
   * @returns Resolves once the move is applied.
   */
  orphanBeyond: (chainNow: ProtocolVersion.ProtocolVersion) => Promise<void>;
  /**
   * Records that a block included the transaction holding any of `identifiers`, with the chain's `verdict`.
   *
   * @param identifiers The included transaction's identifiers.
   * @param verdict What the chain made of it.
   * @returns Resolves once the move is applied.
   */
  included: (identifiers: readonly string[], verdict: InclusionVerdict) => Promise<void>;
  /**
   * Writes the records as they stand, in the stored format, for `TransactionLifecycleServiceImpl.restore` to read back.
   *
   * @returns The store, in the current format version.
   */
  serializeState: () => Promise<string>;
};

/**
 * What {@link TransactionLifecycleServiceImpl.init} builds a service from.
 *
 * @example
 *   const initParams: TransactionLifecycleServiceInitParams<LifecycleTx> = {
 *     txTraits: lifecycleTransactionTraits(configuration.forks.v9),
 *     configuration: { indexerClientConnection: { indexerHttpUrl } },
 *     clock,
 *   };
 */
export type TransactionLifecycleServiceInitParams<TTransaction> = {
  /** The trait each record's transaction is read with, chosen by the protocol version it was built for. */
  txTraits: VersionedTransactionTrait<TTransaction>;
  /** The records to begin with; none when left out. */
  initialState?: Lifecycle.TransactionLifecycle<TTransaction>;
  /** The indexer the service polls. */
  configuration: DefaultTransactionLifecycleServiceConfiguration;
  /** What every move and sweep reads the time from; the system clock when left out. */
  clock?: WallClock;
};

/**
 * A source of the current time, as the facade keeps one.
 *
 * @example
 *   const clock: WallClock = { now: () => new Date() };
 */
export type WallClock = Readonly<{
  /** The current time. */
  now: () => Date;
}>;

/** The Effect clock that reads `wallClock`, sleeping as the system clock does. */
const effectClockOf = (wallClock: WallClock): Clock.Clock => {
  const system = Clock.make();
  const millis = (): number => wallClock.now().getTime();
  return {
    [Clock.ClockTypeId]: Clock.ClockTypeId,
    unsafeCurrentTimeMillis: millis,
    currentTimeMillis: Effect.sync(millis),
    unsafeCurrentTimeNanos: () => BigInt(millis()) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(millis()) * 1_000_000n),
    sleep: (duration) => system.sleep(duration),
  };
};

/**
 * Runs a {@link TransactionLifecycleServiceEffectImpl}, polling the configured indexer once a second between `start` and
 * `stop`.
 *
 * @example
 *   const service = await TransactionLifecycleServiceImpl.init({ txTraits, configuration });
 *   await service.start();
 */
export class TransactionLifecycleServiceImpl<TTransaction> implements TransactionLifecycleService<TTransaction> {
  /**
   * Builds a service, empty or holding `initialState`.
   *
   * @param initParams The traits records are read with, the indexer to poll, and any records to begin with.
   * @returns The service, not yet polling.
   */
  static init<TTransaction>(
    initParams: TransactionLifecycleServiceInitParams<TTransaction>,
  ): Promise<TransactionLifecycleServiceImpl<TTransaction>> {
    return pipe(
      Scope.make(),
      Effect.map(
        (scope) =>
          new TransactionLifecycleServiceImpl<TTransaction>(
            new TransactionLifecycleServiceEffectImpl(initParams.txTraits, initParams.initialState),
            scope,
            initParams.configuration,
            pipe(Option.fromNullable(initParams.clock), Option.map(effectClockOf), Option.getOrElse(Clock.make)),
          ),
      ),
      Effect.runPromise,
    );
  }

  /**
   * Builds a service holding the records a previous one stored.
   *
   * @param data What `Lifecycle.serialize` wrote.
   * @param txTraits The traits each record's transaction is read with.
   * @param configuration The indexer to poll.
   * @param clock What every move and sweep reads the time from; the system clock when left out.
   * @returns The service, not yet polling; rejects with why the payload could not be read.
   */
  static restore<TTransaction>(
    data: string,
    txTraits: VersionedTransactionTrait<TTransaction>,
    configuration: DefaultTransactionLifecycleServiceConfiguration,
    clock?: WallClock,
  ): Promise<TransactionLifecycleServiceImpl<TTransaction>> {
    return pipe(
      Lifecycle.deserialize(data, txTraits),
      EitherOps.toEffect,
      Effect.flatMap((initialState) =>
        Effect.promise(() =>
          TransactionLifecycleServiceImpl.init({ txTraits, initialState, configuration, ...(clock ? { clock } : {}) }),
        ),
      ),
      Effect.runPromise,
    );
  }

  #effectService: TransactionLifecycleServiceEffect<TTransaction>;
  #scope: Scope.CloseableScope;
  #configuration: DefaultTransactionLifecycleServiceConfiguration;
  #clock: Clock.Clock;

  /**
   * Wraps an Effect service. Prefer {@link TransactionLifecycleServiceImpl.init} or
   * {@link TransactionLifecycleServiceImpl.restore}, which build the scope and clock for you.
   *
   * @param effectService The service whose records this one holds.
   * @param scope The scope polling runs in; {@link stop} closes it.
   * @param configuration The indexer to poll.
   * @param clock What every move and sweep reads the time from.
   */
  constructor(
    effectService: TransactionLifecycleServiceEffect<TTransaction>,
    scope: Scope.CloseableScope,
    configuration: DefaultTransactionLifecycleServiceConfiguration,
    clock: Clock.Clock,
  ) {
    this.#effectService = effectService;
    this.#scope = scope;
    this.#configuration = configuration;
    this.#clock = clock;
  }

  /** Runs one move against the service's clock, so every record is stamped with the time its caller keeps. */
  #run(move: Effect.Effect<void>): Promise<void> {
    return Effect.runPromise(Effect.withClock(move, this.#clock));
  }

  /**
   * Starts polling the configured indexer once a second, in the background, until {@link stop}.
   *
   * @returns Resolves once polling has started.
   */
  start(): Promise<void> {
    return this.#effectService
      .startPolling(Stream.tick(Duration.seconds(1)))
      .pipe(
        Effect.withClock(this.#clock),
        Effect.provide(HttpQueryClient.layer({ url: this.#configuration.indexerClientConnection.indexerHttpUrl })),
        Effect.provideService(Scope.Scope, this.#scope),
        Effect.provide(DefaultServices.liveServices),
        Effect.runFork,
        () => Promise.resolve(),
      );
  }

  /**
   * Stops polling by closing the scope it runs in. No indexer query and no sweep runs after it resolves; the records
   * are kept, so they can still be read and saved.
   *
   * @returns Resolves once polling has stopped.
   */
  stop(): Promise<void> {
    return pipe(Scope.close(this.#scope, Exit.succeed(undefined)), Effect.runPromise);
  }

  /**
   * The records, now and each time they move.
   *
   * @returns An observable that starts with the records as they stand.
   */
  state(): rx.Observable<Lifecycle.TransactionLifecycle<TTransaction>> {
    return this.#effectService.state().pipe(ObservableOps.fromStream);
  }

  /**
   * Records a transaction as balanced, at the service's clock time.
   *
   * @param facts The balanced transaction, with its proofs erased, and what the record keeps of it.
   * @returns Resolves once the move is applied.
   */
  balanced(facts: Lifecycle.TransactionFacts<TTransaction>): Promise<void> {
    return this.#run(this.#effectService.balanced(facts));
  }

  /**
   * Records a transaction as finalized, at the service's clock time.
   *
   * @param facts The finalized transaction and what the record keeps of it.
   * @returns Resolves once the move is applied.
   */
  finalized(facts: Lifecycle.TransactionFacts<TTransaction>): Promise<void> {
    return this.#run(this.#effectService.finalized(facts));
  }

  /**
   * Records a transaction as submitted, at the service's clock time, which becomes its submission time.
   *
   * @param facts The submitted transaction and what the record keeps of it.
   * @returns Resolves once the move is applied.
   */
  submitted(facts: Lifecycle.TransactionFacts<TTransaction>): Promise<void> {
    return this.#run(this.#effectService.submitted(facts));
  }

  /**
   * Records that the transaction holding any of `identifiers` was reverted.
   *
   * @param identifiers The reverted transaction's identifiers.
   * @returns Resolves once the move is applied.
   */
  reverted(identifiers: readonly string[]): Promise<void> {
    return this.#run(this.#effectService.reverted(identifiers));
  }

  /**
   * Gives up on every live transaction built for an epoch the chain has left by `chainNow`.
   *
   * @param chainNow The protocol version the chain has reached.
   * @returns Resolves once the move is applied.
   */
  orphanBeyond(chainNow: ProtocolVersion.ProtocolVersion): Promise<void> {
    return this.#run(this.#effectService.orphanBeyond(chainNow));
  }

  /**
   * Records that a block included the transaction holding any of `identifiers`, with the chain's `verdict`.
   *
   * @param identifiers The included transaction's identifiers.
   * @param verdict What the chain made of it.
   * @returns Resolves once the move is applied.
   */
  included(identifiers: readonly string[], verdict: InclusionVerdict): Promise<void> {
    return this.#run(this.#effectService.included(identifiers, verdict));
  }

  /**
   * Writes the records as they stand, with the traits the service was built with, for {@link restore} to read back.
   *
   * @example
   *   const stored = await facade.transactionLifecycleService.serializeState();
   *
   * @returns The store, in the current format version.
   */
  serializeState(): Promise<string> {
    return Effect.runPromise(this.#effectService.serializeState());
  }
}
