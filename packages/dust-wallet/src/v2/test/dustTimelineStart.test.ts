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

/**
 * Finding where a chain's dust event timeline reaches a protocol boundary.
 *
 * @remarks
 *   A fresh wallet that skips the ledger-v8 dust history starts the V2 variant with its cursor on the last dust event
 *   below `forks.v9`. The indexer offers that only as a stream of events from an id onwards, and the ids have gaps
 *   where other event kinds sit, so the timelines here have gaps on both sides of the boundary.
 */

import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  DustLedgerEvents,
  type DustLedgerEventsSubscription,
  type DustLedgerEventsSubscriptionVariables,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import { type SubscriptionClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { type ClientError, ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Duration, Array as EArray, Effect, Fiber, Option, Ref, Stream, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import { findDustTimelineStart } from '../Sync.js';

const boundary = ProtocolVersion.ProtocolVersion(2_000_000n);
const v8Version = 1_000_000;
const v9Version = 2_001_000;

const configuration = {
  indexerClientConnection: {
    indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
    indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
  },
  networkId: 'undeployed',
};

type TimelineEvent = Readonly<{ id: number; protocolVersion: number }>;

type Lookup = (
  variables: DustLedgerEventsSubscriptionVariables,
) => Stream.Stream<DustLedgerEventsSubscription, ClientError | ServerError, SubscriptionClient>;

const at =
  (protocolVersion: number) =>
  (id: number): TimelineEvent => ({ id, protocolVersion });

/** Ledger-v8 dust events at `v8Ids`, then ledger-v9 ones at `v9Ids`. */
const timeline = (v8Ids: readonly number[], v9Ids: readonly number[]): readonly TimelineEvent[] => [
  ...v8Ids.map(at(v8Version)),
  ...v9Ids.map(at(v9Version)),
];

type Recorder<T> = Ref.Ref<readonly T[]>;

const recorder = <T>(): Recorder<T> => Effect.runSync(Ref.make<readonly T[]>([]));

/**
 * The indexer serving `events`: every event from the first at or after the id asked for, then nothing, with the
 * subscription left open as the indexer leaves it.
 *
 * @remarks
 *   `raw` is empty because locating the boundary needs only ids and versions; a search that read an event's bytes would
 *   fail here instead of answering.
 */
const servingTimeline = (
  events: readonly TimelineEvent[],
  asked: Recorder<DustLedgerEventsSubscriptionVariables> = recorder(),
): Lookup => {
  const maxId = Math.max(...events.map(({ id }) => id));
  return (variables) =>
    Stream.unwrap(
      Ref.update(asked, (all) => [...all, variables]).pipe(
        Effect.as(
          Stream.concat(
            Stream.fromIterable(
              events
                .filter(({ id }) => variables.id === null || variables.id === undefined || id >= variables.id)
                .map(({ id, protocolVersion }) => ({
                  dustLedgerEvents: {
                    type: 'DustInitialUtxo' as const,
                    id,
                    raw: '',
                    maxId,
                    protocolVersion,
                  },
                })),
            ),
            Stream.never,
          ),
        ),
      ),
    );
};

/** The indexer serving `events` for the first `answered` lookups, and failing every one after. */
const failingAfter = (answered: number, events: readonly TimelineEvent[]): Lookup => {
  const asked = recorder<DustLedgerEventsSubscriptionVariables>();
  const serve = servingTimeline(events, asked);
  return (variables) =>
    Stream.unwrap(
      Ref.get(asked).pipe(
        Effect.map((all) =>
          all.length < answered ? serve(variables) : Stream.fail(new ServerError({ message: 'the indexer is down' })),
        ),
      ),
    );
};

const search = (lookup: Lookup) =>
  findDustTimelineStart(configuration, boundary).pipe(
    Effect.provideService(DustLedgerEvents.tag, lookup),
    Effect.runPromise,
  );

const startingAt = (cursor: bigint) =>
  Option.some({ cursor, version: ProtocolVersion.ProtocolVersion(BigInt(v9Version)) });

describe('finding where the dust event timeline reaches a protocol boundary', () => {
  it.each([
    { shape: 'gaps on both sides of the boundary', events: timeline([1, 2, 4, 7, 8], [11, 12, 15]), cursor: 8n },
    { shape: 'the boundary after the first event', events: timeline([1], [2, 3, 4, 5, 6, 7, 8, 9]), cursor: 1n },
    { shape: 'the boundary before the last event', events: timeline([1, 2, 3, 4, 5, 6, 7, 8, 9], [50]), cursor: 9n },
    { shape: 'a timeline that does not begin at id 1', events: timeline([100, 205], [300, 301]), cursor: 205n },
  ])('parks the cursor on the last event below the boundary, with $shape', async ({ events, cursor }) => {
    expect(await search(servingTimeline(events))).toEqual(startingAt(cursor));
  });

  it('reports the version the first event from the boundary carries, not one the chain reached since', async () => {
    // The version a wallet crossing the boundary records is the one on the event that handed it over.
    const events = [...timeline([1, 2, 3], [5, 6]), at(2_002_000)(9)];

    expect(await search(servingTimeline(events))).toEqual(startingAt(3n));
  });

  it('asks the indexer a number of times logarithmic in the length of the timeline', async () => {
    const asked = recorder<DustLedgerEventsSubscriptionVariables>();
    const events = timeline(EArray.range(1, 6_000), EArray.range(6_001, 10_000));

    expect(await search(servingTimeline(events, asked))).toEqual(startingAt(6_000n));
    // A scan would open a subscription per event; a search over 10,000 ids needs a couple of dozen at most.
    expect(Effect.runSync(Ref.get(asked)).length).toBeLessThanOrEqual(20);
  });

  it.each([
    { shape: 'a chain still below the boundary', events: timeline([1, 2, 3], []) },
    { shape: 'a chain born on ledger-v9', events: timeline([], [1, 2, 3]) },
  ])('finds nothing on $shape', async ({ events }) => {
    expect(await search(servingTimeline(events))).toEqual(Option.none());
  });

  it.each([
    { when: 'at the first lookup', answered: 0 },
    { when: 'part-way through the search', answered: 3 },
  ])('finds nothing when the indexer fails $when', async ({ answered }) => {
    const events = timeline(EArray.range(1, 600), EArray.range(601, 1_000));

    expect(await search(failingAfter(answered, events))).toEqual(Option.none());
  });

  it('finds nothing on a chain with no dust event, once the indexer has had time to answer', async () => {
    // The indexer keeps a subscription to an empty timeline open and never writes to it.
    const silent: Lookup = () => Stream.never;

    const found = await Effect.gen(function* () {
      const searching = yield* Effect.fork(findDustTimelineStart(configuration, boundary));
      yield* TestClock.adjust(Duration.millis(1));
      yield* TestClock.adjust(Duration.minutes(1));
      return yield* Fiber.join(searching);
    }).pipe(
      Effect.provideService(DustLedgerEvents.tag, silent),
      Effect.provide(TestContext.TestContext),
      Effect.runPromise,
    );

    expect(found).toEqual(Option.none());
  });
});
