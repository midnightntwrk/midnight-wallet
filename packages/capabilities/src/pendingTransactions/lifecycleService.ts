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
import { type QueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import {
  Array as Arr,
  DateTime,
  Effect,
  Option,
  type ParseResult,
  pipe,
  type Scope,
  Stream,
  SubscriptionRef,
} from 'effect';
import * as Lifecycle from './lifecycle.js';
import {
  type FailedTransactionResult,
  type TransactionTrait,
  traitForVersion,
  type VersionedTransactionTrait,
} from './pendingTransactions.js';

/** Holds one lifecycle record per transaction and moves it as the facade and the chain report events. */
export type TransactionLifecycleServiceEffect<TTransaction> = {
  /**
   * Runs one sweep per tick: records whose TTL has passed end, the ends are published, and every final record whose TTL
   * has passed is dropped.
   */
  startPolling: (ticks: Stream.Stream<unknown>) => Effect.Effect<void, Error, QueryClient | Scope.Scope>;
  /** The records, published when they move. */
  state: () => Stream.Stream<Lifecycle.TransactionLifecycle<TTransaction>>;
  /** Records a transaction as balanced, now. */
  balanced: (facts: Lifecycle.TransactionFacts<TTransaction>) => Effect.Effect<void>;
  /** Records a transaction as finalized, now. */
  finalized: (facts: Lifecycle.TransactionFacts<TTransaction>) => Effect.Effect<void>;
  /** Records a transaction as submitted, now. */
  submitted: (facts: Lifecycle.TransactionFacts<TTransaction>) => Effect.Effect<void>;
  /** Records that the transaction holding any of `identifiers` was reverted. */
  reverted: (identifiers: readonly string[]) => Effect.Effect<void>;
  /** Gives up on every live transaction built for an epoch the chain has left by `chainNow`. */
  orphanBeyond: (chainNow: ProtocolVersion.ProtocolVersion) => Effect.Effect<void>;
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

  constructor(
    txTraits: VersionedTransactionTrait<TTransaction>,
    initialState?: Lifecycle.TransactionLifecycle<TTransaction>,
  ) {
    this.#txTraits = txTraits;
    // Built synchronously so the service can be constructed outside an Effect, as the facade does.
    this.#state = SubscriptionRef.make(initialState ?? Lifecycle.empty<TTransaction>()).pipe(Effect.runSync);
  }

  /**
   * Every write publishes, whether or not it moved anything, so consecutive identical values are dropped. A transition
   * that moves nothing returns the very state it was given, so comparing by identity never hides a real move.
   */
  state(): Stream.Stream<Lifecycle.TransactionLifecycle<TTransaction>> {
    return Stream.concat(Stream.fromEffect(SubscriptionRef.get(this.#state)), this.#state.changes).pipe(
      Stream.changesWith((a, b) => a === b),
    );
  }

  /**
   * Each tick asks the indexer first and sweeps after, so an inclusion found on the tick a TTL passes is recorded
   * before the TTL could end the record: the inclusion happened within the TTL.
   */
  startPolling(ticks: Stream.Stream<unknown>): Effect.Effect<void, Error, QueryClient | Scope.Scope> {
    return ticks.pipe(Stream.runForEach(() => pipe(this.poll(), Effect.andThen(this.sweep()))));
  }

  balanced(facts: Lifecycle.TransactionFacts<TTransaction>): Effect.Effect<void> {
    return this.moveNow((state, now) => Lifecycle.balanced(state, facts, now));
  }

  finalized(facts: Lifecycle.TransactionFacts<TTransaction>): Effect.Effect<void> {
    return this.moveNow((state, now) => Lifecycle.finalized(state, facts, now));
  }

  submitted(facts: Lifecycle.TransactionFacts<TTransaction>): Effect.Effect<void> {
    return this.moveNow((state, now) => Lifecycle.submitted(state, facts, now));
  }

  reverted(identifiers: readonly string[]): Effect.Effect<void> {
    return SubscriptionRef.update(this.#state, (state) => Lifecycle.reverted(state, identifiers));
  }

  orphanBeyond(chainNow: ProtocolVersion.ProtocolVersion): Effect.Effect<void> {
    return SubscriptionRef.update(this.#state, (state) => Lifecycle.orphanBeyond(state, this.#txTraits, chainNow));
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
                onSome: (verdict) =>
                  SubscriptionRef.update(this.#state, (state) =>
                    verdict.status === 'SUCCESS'
                      ? Lifecycle.confirmed(state, identifiers)
                      : Lifecycle.rejected(state, identifiers, verdict),
                  ),
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

type Verdict = Readonly<{ status: 'SUCCESS' }> | FailedTransactionResult;

/**
 * What the indexer reports for `tx`: the result of a regular transaction carrying every one of its identifiers, or
 * nothing while it has none. A query that fails reports nothing, so the next tick asks again.
 */
const verdictOf = <TTransaction>(
  tx: TTransaction,
  trait: TransactionTrait<TTransaction>,
): Effect.Effect<Option.Option<Verdict>, never, QueryClient> =>
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
        Effect.as(Option.none<Verdict>()),
      ),
    ),
  );

/** A final result as a verdict, segments stripped to what the chain decided; any other status is no verdict yet. */
const verdictFrom = (result: {
  readonly status: string;
  readonly segments?: ReadonlyArray<{ readonly id: number; readonly success: boolean }> | null;
}): Option.Option<Verdict> => {
  const segments = (result.segments ?? []).map(({ id, success }) => ({ id, success }));
  return result.status === 'SUCCESS'
    ? Option.some({ status: 'SUCCESS' })
    : result.status === 'FAILURE' || result.status === 'PARTIAL_SUCCESS'
      ? Option.some({ status: result.status, segments })
      : Option.none();
};
