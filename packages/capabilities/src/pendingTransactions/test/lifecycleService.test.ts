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
import { TransactionStatus, type TransactionStatusQuery } from '@midnightntwrk/wallet-sdk-indexer-client';
import { QueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { Chunk, DateTime, Effect, Either, Fiber, Option, pipe, Stream, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Lifecycle from '../lifecycle.js';
import { TransactionLifecycleServiceEffectImpl } from '../lifecycleService.js';
import type * as PendingTransactions from '../pendingTransactions.js';

type FakeTransaction = Readonly<{ ids: readonly string[] }>;

const fakeTrait: PendingTransactions.TransactionTrait<FakeTransaction> = {
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
const traits: PendingTransactions.VersionedTransactionTrait<FakeTransaction> = Either.getOrThrow(
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
