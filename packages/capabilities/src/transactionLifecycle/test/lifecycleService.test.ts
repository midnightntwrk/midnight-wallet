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

import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  TransactionStatus,
  type TransactionStatusQuery,
  type TransactionStatusQueryVariables,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import { type Query, QueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Chunk, DateTime, Effect, Either, Fiber, Option, pipe, Ref, Stream, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Lifecycle from '../lifecycle.js';
import { TransactionLifecycleServiceEffectImpl } from '../lifecycleService.js';
import type * as TransactionTraits from '../transactionTraits.js';

type FakeTransaction = Readonly<{ ids: readonly string[] }>;

const fakeTrait: TransactionTraits.TransactionTrait<FakeTransaction> = {
  isTx: (data): data is FakeTransaction => typeof data === 'object' && data !== null && 'ids' in data,
  serialize: (tx) => Buffer.from(JSON.stringify(tx), 'utf-8'),
  // Type cast required because: the bytes are only ever ones `serialize` wrote.
  deserialize: (bytes) => JSON.parse(Buffer.from(bytes).toString('utf-8')) as FakeTransaction,
  ids: (tx) => tx.ids,
  firstId: (tx) => tx.ids[0],
  areAllTxIdsIncluded: (tx, ids) => tx.ids.every((id) => ids.includes(id)),
  isOneIncludedInOther: () => false,
  hasTTLExpired: () => false,
  intentHashes: (tx) => tx.ids.map((id) => `intent-${id}`),
  inputs: (tx) => ({ unshielded: tx.ids.map((id) => `${id}#0`) }),
  ttl: () => TTL,
};

const FORK = ProtocolVersion.V9NativeForkVersion;
const V8 = ProtocolVersion.ProtocolVersion(3n);
const V9 = ProtocolVersion.ProtocolVersion(FORK + 1n);

/** Two epochs, so a record built for the first is stranded once the chain reaches the second. */
const traits: TransactionTraits.VersionedTransactionTrait<FakeTransaction> = Either.getOrThrow(
  ProtocolVersion.makeRegistryFromActivations([
    { sinceVersion: ProtocolVersion.MinSupportedVersion, value: fakeTrait },
    { sinceVersion: FORK, value: fakeTrait },
  ]),
);

const at = (iso: string): DateTime.Utc => DateTime.unsafeMake(iso);

const BALANCED_AT = at('2026-01-01T00:00:00.000Z');
const FINALIZED_AT = at('2026-01-01T00:01:00.000Z');
const SUBMITTED_AT = at('2026-01-01T00:02:00.000Z');
const TTL = new Date('2026-01-01T01:00:00.000Z');
const BEFORE_TTL = at('2026-01-01T00:30:00.000Z');
const PAST_TTL = at('2026-01-01T02:00:00.000Z');

const facts = (ids: readonly string[]): Lifecycle.TransactionFacts<FakeTransaction> => ({
  tx: { ids },
  identifiers: ids,
  intentHashes: ids.map((id) => `intent-${id}`),
  inputs: { unshielded: ids.map((id) => `${id}#0`) },
  ttl: TTL,
  protocolVersion: V8,
});

/** The record the facts describe, as it stands in `state` since `createdAt`, submitted at `submittedAt` if ever. */
const recordOf = (
  given: Lifecycle.TransactionFacts<FakeTransaction>,
  createdAt: DateTime.Utc,
  state: Lifecycle.LifecycleState,
  submittedAt: Option.Option<DateTime.Utc> = Option.none(),
): Lifecycle.LifecycleRecord<FakeTransaction> => ({
  identifiers: given.identifiers,
  intentHashes: given.intentHashes,
  inputs: given.inputs,
  ttl: given.ttl,
  protocolVersion: Option.some(given.protocolVersion),
  tx: Option.some(given.tx),
  createdAt,
  submittedAt,
  state,
});

const setClock = (instant: DateTime.Utc) => TestClock.setTime(DateTime.toEpochMillis(instant));

const currentRecords = (service: TransactionLifecycleServiceEffectImpl<FakeTransaction>) =>
  pipe(
    service.state(),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
    Effect.map((state) => state.records),
  );

/** Runs the service's poll for `count` ticks against an indexer that has seen none of its transactions. */
const tick = (service: TransactionLifecycleServiceEffectImpl<FakeTransaction>, count = 1) =>
  service.startPolling(Stream.range(1, count)).pipe(
    Effect.provideService(TransactionStatus.tag, () => Effect.succeed<TransactionStatusQuery>({ transactions: [] })),
    // Type cast required because: the stubbed status query above never reaches a client.
    Effect.provideService(QueryClient, {} as unknown as QueryClient.Service),
    Effect.scoped,
  );

describe('The transaction lifecycle service', () => {
  it('should record each move at the time the clock shows when it is made, so a submitted record keeps when it began', () =>
    Effect.gen(function* () {
      const service = new TransactionLifecycleServiceEffectImpl(traits);
      const spend = facts(['id-a']);

      yield* setClock(BALANCED_AT);
      yield* service.balanced(spend);
      expect(yield* currentRecords(service)).toStrictEqual([
        recordOf(spend, BALANCED_AT, Lifecycle.LifecycleState.Balanced()),
      ]);

      yield* setClock(FINALIZED_AT);
      yield* service.finalized(spend);
      expect(yield* currentRecords(service)).toStrictEqual([
        recordOf(spend, BALANCED_AT, Lifecycle.LifecycleState.Finalized()),
      ]);

      yield* setClock(SUBMITTED_AT);
      yield* service.submitted(spend);
      expect(yield* currentRecords(service)).toStrictEqual([
        recordOf(spend, BALANCED_AT, Lifecycle.LifecycleState.Submitted(), Option.some(SUBMITTED_AT)),
      ]);
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise));

  it('should end a reverted transaction as reverted, because no chain will be asked to include it', () =>
    Effect.gen(function* () {
      const service = new TransactionLifecycleServiceEffectImpl(traits);
      const spend = facts(['id-a']);

      yield* setClock(BALANCED_AT);
      yield* service.balanced(spend);
      yield* service.reverted(['id-a']);

      expect(yield* currentRecords(service)).toStrictEqual([
        recordOf(spend, BALANCED_AT, Lifecycle.LifecycleState.Reverted()),
      ]);
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise));

  it('should orphan a transaction built for an epoch the chain has left, read against its own transaction traits', () =>
    Effect.gen(function* () {
      const service = new TransactionLifecycleServiceEffectImpl(traits);
      const spend = facts(['id-a']);

      yield* setClock(BALANCED_AT);
      yield* service.submitted(spend);
      yield* service.orphanBeyond(V9);

      expect(yield* currentRecords(service)).toStrictEqual([
        recordOf(
          spend,
          BALANCED_AT,
          Lifecycle.LifecycleState.Orphaned({ authoredFor: V8, chainNow: V9 }),
          Option.some(BALANCED_AT),
        ),
      ]);
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise));

  it('should confirm a transaction reported included with success, keeping its record until its TTL', () =>
    Effect.gen(function* () {
      const service = new TransactionLifecycleServiceEffectImpl(traits);
      const spend = facts(['id-a', 'id-b']);

      yield* setClock(BALANCED_AT);
      yield* service.submitted(spend);
      yield* service.included(['id-a', 'id-b'], { status: 'SUCCESS' });

      expect(yield* currentRecords(service)).toStrictEqual([
        recordOf(spend, BALANCED_AT, Lifecycle.LifecycleState.Confirmed(), Option.some(BALANCED_AT)),
      ]);
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise));

  it('should reject a transaction reported included with a failure, keeping the chain’s verdict', () =>
    Effect.gen(function* () {
      const service = new TransactionLifecycleServiceEffectImpl(traits);
      const spend = facts(['id-a']);
      const verdict = { status: 'FAILURE', segments: [{ id: 0, success: false }] } as const;

      yield* setClock(BALANCED_AT);
      yield* service.submitted(spend);
      yield* service.included(['id-a'], verdict);

      expect(yield* currentRecords(service)).toStrictEqual([
        recordOf(spend, BALANCED_AT, Lifecycle.LifecycleState.Rejected({ verdict }), Option.some(BALANCED_AT)),
      ]);
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise));

  describe('on a tick', () => {
    it.each([
      {
        name: 'a balanced transaction expires',
        move: (service: TransactionLifecycleServiceEffectImpl<FakeTransaction>) => service.balanced(facts(['id-a'])),
        live: recordOf(facts(['id-a']), BALANCED_AT, Lifecycle.LifecycleState.Balanced()),
        ended: recordOf(facts(['id-a']), BALANCED_AT, Lifecycle.LifecycleState.Expired()),
      },
      {
        name: 'a submitted transaction is rejected',
        move: (service: TransactionLifecycleServiceEffectImpl<FakeTransaction>) => service.submitted(facts(['id-a'])),
        live: recordOf(facts(['id-a']), BALANCED_AT, Lifecycle.LifecycleState.Submitted(), Option.some(BALANCED_AT)),
        ended: recordOf(
          facts(['id-a']),
          BALANCED_AT,
          Lifecycle.LifecycleState.Rejected({ verdict: { status: 'TTL_PASSED' } }),
          Option.some(BALANCED_AT),
        ),
      },
    ])(
      'should publish that $name once its TTL has passed, then drop it on the same tick, so a caller sees the end once',
      ({ move, live, ended }) =>
        Effect.gen(function* () {
          const service = new TransactionLifecycleServiceEffectImpl(traits);

          yield* setClock(BALANCED_AT);
          yield* move(service);

          const published = service.state().pipe(
            Stream.takeUntil((state) => state.records.length === 0),
            Stream.runCollect,
            Effect.runFork,
          );

          yield* setClock(PAST_TTL);
          yield* tick(service, 2);

          const emitted = yield* Fiber.join(published);
          expect(Chunk.toReadonlyArray(emitted).map((state) => state.records)).toStrictEqual([[live], [ended], []]);
        }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise),
    );

    it('should leave every record whose TTL is still ahead as it was, live or final', () =>
      Effect.gen(function* () {
        const service = new TransactionLifecycleServiceEffectImpl(traits);
        const live = facts(['id-a']);
        const abandoned = facts(['id-b']);

        yield* setClock(BALANCED_AT);
        yield* service.balanced(live);
        yield* service.balanced(abandoned);
        yield* service.reverted(['id-b']);

        yield* setClock(BEFORE_TTL);
        yield* tick(service);

        expect(yield* currentRecords(service)).toStrictEqual([
          recordOf(live, BALANCED_AT, Lifecycle.LifecycleState.Balanced()),
          recordOf(abandoned, BALANCED_AT, Lifecycle.LifecycleState.Reverted()),
        ]);
      }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise));
  });

  it('should restore the records it serialized, each in the state it was left in', () =>
    Effect.gen(function* () {
      const service = new TransactionLifecycleServiceEffectImpl(traits);
      const sent = facts(['id-a']);
      const held = facts(['id-b']);

      yield* setClock(BALANCED_AT);
      yield* service.balanced(held);
      yield* setClock(SUBMITTED_AT);
      yield* service.submitted(sent);

      const stored = yield* service.state().pipe(
        Stream.runHead,
        Effect.map(Option.getOrThrow),
        Effect.map((state) => Lifecycle.serialize(state, traits)),
      );
      const restored = yield* TransactionLifecycleServiceEffectImpl.restore(stored, traits);

      expect(yield* currentRecords(restored)).toStrictEqual([
        recordOf(held, BALANCED_AT, Lifecycle.LifecycleState.Balanced()),
        recordOf(sent, SUBMITTED_AT, Lifecycle.LifecycleState.Submitted(), Option.some(SUBMITTED_AT)),
      ]);
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise));
});

type StatusQuery = Query.Query.QueryFn<TransactionStatusQuery, TransactionStatusQueryVariables>;
type ReportedStatus = 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS';
type Segments = ReadonlyArray<{ id: number; success: boolean }>;

/** What the indexer reports for each transaction it has seen, keyed by the identifiers it reports it under. */
type Reported = ReadonlyArray<{ identifiers: readonly string[]; status: ReportedStatus; segments: Segments }>;

/** An indexer that answers from `reported`, noting every identifier it was asked about in `asked`. */
const indexerOf =
  (reported: Reported, asked: Ref.Ref<readonly string[]>): StatusQuery =>
  ({ transactionId }) =>
    pipe(
      Ref.update(asked, (ids) => [...ids, transactionId]),
      Effect.as<TransactionStatusQuery>({
        transactions: reported
          .filter((entry) => entry.identifiers.includes(transactionId))
          .map((entry) => ({
            __typename: 'RegularTransaction' as const,
            identifiers: [...entry.identifiers],
            transactionResult: {
              __typename: 'TransactionResult' as const,
              status: entry.status,
              segments: entry.segments.map((segment) => ({ __typename: 'Segment' as const, ...segment })),
            },
          })),
      }),
    );

/** Runs the service's poll for `count` ticks against `indexer`. */
const tickAgainst = (
  service: TransactionLifecycleServiceEffectImpl<FakeTransaction>,
  indexer: StatusQuery,
  count = 1,
) =>
  service.startPolling(Stream.range(1, count)).pipe(
    Effect.provideService(TransactionStatus.tag, indexer),
    // Type cast required because: the stubbed status query above never reaches a client.
    Effect.provideService(QueryClient, {} as unknown as QueryClient.Service),
    Effect.scoped,
  );

const SEGMENTS: Segments = [
  { id: 0, success: true },
  { id: 1, success: false },
];

/** Moves a fresh record of `spend` into each live state, the way the facade would. */
const LIVE_MOVES = [
  {
    live: 'balanced',
    move: (service: TransactionLifecycleServiceEffectImpl<FakeTransaction>, spend: typeof SPEND) =>
      service.balanced(spend),
    submittedAt: Option.none<DateTime.Utc>(),
  },
  {
    live: 'finalized',
    move: (service: TransactionLifecycleServiceEffectImpl<FakeTransaction>, spend: typeof SPEND) =>
      service.finalized(spend),
    submittedAt: Option.none<DateTime.Utc>(),
  },
  {
    live: 'submitted',
    move: (service: TransactionLifecycleServiceEffectImpl<FakeTransaction>, spend: typeof SPEND) =>
      service.submitted(spend),
    submittedAt: Option.some(BALANCED_AT),
  },
];

const SPEND = facts(['id-a', 'id-b']);

describe('The transaction lifecycle service polling the indexer', () => {
  it.each(LIVE_MOVES)(
    'should confirm a $live transaction the indexer reports included, and keep its record, because whoever submitted it the coins are spent',
    ({ move, submittedAt }) =>
      Effect.gen(function* () {
        const service = new TransactionLifecycleServiceEffectImpl(traits);
        const asked = yield* Ref.make<readonly string[]>([]);

        yield* setClock(BALANCED_AT);
        yield* move(service, SPEND);
        yield* setClock(BEFORE_TTL);
        yield* tickAgainst(
          service,
          indexerOf([{ identifiers: SPEND.identifiers, status: 'SUCCESS', segments: [] }], asked),
        );

        expect(yield* currentRecords(service)).toStrictEqual([
          recordOf(SPEND, BALANCED_AT, Lifecycle.LifecycleState.Confirmed(), submittedAt),
        ]);
      }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise),
  );

  it.each(['FAILURE', 'PARTIAL_SUCCESS'] as const)(
    'should reject a submitted transaction the indexer reports with %s, carrying the segments the chain reported',
    (status) =>
      Effect.gen(function* () {
        const service = new TransactionLifecycleServiceEffectImpl(traits);
        const asked = yield* Ref.make<readonly string[]>([]);

        yield* setClock(BALANCED_AT);
        yield* service.submitted(SPEND);
        yield* setClock(BEFORE_TTL);
        yield* tickAgainst(service, indexerOf([{ identifiers: SPEND.identifiers, status, segments: SEGMENTS }], asked));

        expect(yield* currentRecords(service)).toStrictEqual([
          recordOf(
            SPEND,
            BALANCED_AT,
            Lifecycle.LifecycleState.Rejected({ verdict: { status, segments: SEGMENTS } }),
            Option.some(BALANCED_AT),
          ),
        ]);
      }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise),
  );

  it.each([
    { name: 'the indexer has not seen it', reported: [] },
    {
      name: 'the indexer reports a transaction holding only some of its identifiers',
      reported: [{ identifiers: ['id-a'], status: 'SUCCESS' as const, segments: [] }],
    },
  ])('should leave a submitted transaction as it was while $name', ({ reported }) =>
    Effect.gen(function* () {
      const service = new TransactionLifecycleServiceEffectImpl(traits);
      const asked = yield* Ref.make<readonly string[]>([]);

      yield* setClock(BALANCED_AT);
      yield* service.submitted(SPEND);
      yield* setClock(BEFORE_TTL);
      yield* tickAgainst(service, indexerOf(reported, asked));

      expect(yield* currentRecords(service)).toStrictEqual([
        recordOf(SPEND, BALANCED_AT, Lifecycle.LifecycleState.Submitted(), Option.some(BALANCED_AT)),
      ]);
      expect(yield* Ref.get(asked)).toStrictEqual(['id-a']);
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise),
  );

  it('should confirm a transaction the indexer reports included on the tick its TTL passes, because the inclusion came first', () =>
    Effect.gen(function* () {
      const service = new TransactionLifecycleServiceEffectImpl(traits);
      const asked = yield* Ref.make<readonly string[]>([]);

      yield* setClock(BALANCED_AT);
      yield* service.submitted(SPEND);

      const published = service.state().pipe(
        Stream.takeUntil((state) => state.records.length === 0),
        Stream.runCollect,
        Effect.runFork,
      );

      yield* setClock(PAST_TTL);
      yield* tickAgainst(
        service,
        indexerOf([{ identifiers: SPEND.identifiers, status: 'SUCCESS', segments: [] }], asked),
      );

      const emitted = yield* Fiber.join(published);
      expect(Chunk.toReadonlyArray(emitted).map((state) => state.records)).toStrictEqual([
        [recordOf(SPEND, BALANCED_AT, Lifecycle.LifecycleState.Submitted(), Option.some(BALANCED_AT))],
        [recordOf(SPEND, BALANCED_AT, Lifecycle.LifecycleState.Confirmed(), Option.some(BALANCED_AT))],
        [],
      ]);
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise));

  it('should still end a transaction whose TTL has passed when the indexer cannot be reached, so a poll failure never keeps coins spoken for', () =>
    Effect.gen(function* () {
      const service = new TransactionLifecycleServiceEffectImpl(traits);
      const unreachable: StatusQuery = () => Effect.fail(new ServerError({ message: 'indexer unreachable' }));

      yield* setClock(BALANCED_AT);
      yield* service.balanced(SPEND);

      const published = service.state().pipe(
        Stream.takeUntil((state) => state.records.length === 0),
        Stream.runCollect,
        Effect.runFork,
      );

      yield* setClock(PAST_TTL);
      yield* tickAgainst(service, unreachable);

      const emitted = yield* Fiber.join(published);
      expect(Chunk.toReadonlyArray(emitted).map((state) => state.records)).toStrictEqual([
        [recordOf(SPEND, BALANCED_AT, Lifecycle.LifecycleState.Balanced())],
        [recordOf(SPEND, BALANCED_AT, Lifecycle.LifecycleState.Expired())],
        [],
      ]);
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise));

  it('should ask only about live records that hold their transaction, by each one’s first identifier', () =>
    Effect.gen(function* () {
      const heldOnly: Lifecycle.LifecycleRecord<FakeTransaction> = {
        ...recordOf(facts(['id-held']), BALANCED_AT, Lifecycle.LifecycleState.Balanced()),
        tx: Option.none(),
        protocolVersion: Option.none(),
      };
      const service = new TransactionLifecycleServiceEffectImpl(traits, { records: [heldOnly] });
      const asked = yield* Ref.make<readonly string[]>([]);

      yield* setClock(BALANCED_AT);
      yield* service.balanced(facts(['id-balanced', 'id-balanced-2']));
      yield* service.finalized(facts(['id-finalized']));
      yield* service.submitted(facts(['id-submitted']));
      yield* service.balanced(facts(['id-reverted']));
      yield* service.reverted(['id-reverted']);
      yield* setClock(BEFORE_TTL);
      yield* tickAgainst(service, indexerOf([], asked));

      expect([...(yield* Ref.get(asked))].sort()).toStrictEqual(['id-balanced', 'id-finalized', 'id-submitted']);
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise));
});
