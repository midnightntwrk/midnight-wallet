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
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Option, Ref, Stream, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import { type BackpressureOptions, type Source, withBackpressure } from '../Backpressure.js';

// A session that stays open and stops delivering never fails on its own, so a consumer that is behind waits on it for
// as long as the connection lasts. These tests pin when the wrapper gives up on a silent session, and when it must not:
// silence is also what a source with nothing left to deliver looks like, and what the wrapper's own pause produces.

type Event = { readonly id: bigint; readonly maxId: bigint };

type Variables = { readonly cursor: bigint };

/** What the fake source saw. Mutable by necessity: it is recorded from inside a push-based, callback-driven API. */
type Observed = {
  // The cursor each session was opened at, in order.
  readonly opened: bigint[];
  disposals: number;
};

type Feed = {
  readonly source: Source<Event, Variables, never>;
  /** Delivers an event to the open session, the way a frame arrives on a socket. A closed session receives nothing. */
  readonly deliver: (event: Event) => void;
  readonly observed: Observed;
};

/**
 * A source driven by hand: it delivers exactly what the test tells it to, when the test tells it to, and is otherwise
 * silent while staying open — which is the condition under test.
 */
const makeFeed = (): Feed => {
  const observed: Observed = { opened: [], disposals: 0 };
  const live: { onItem: ((event: Event) => void) | null } = { onItem: null };

  return {
    observed,
    deliver: (event) => live.onItem?.(event),
    source: ({ variables, onItem }) => {
      observed.opened.push(variables.cursor);
      live.onItem = onItem;
      return () => {
        observed.disposals += 1;
        // A session reopened since must keep receiving, so only the session being closed is detached.
        if (live.onItem === onItem) live.onItem = null;
      };
    },
  };
};

const event = (id: bigint, maxId: bigint): Event => ({ id, maxId });

const options = (
  overrides: Partial<BackpressureOptions<Event, Variables>> = {},
): BackpressureOptions<Event, Variables> => ({
  bufferSize: 100,
  resumeThreshold: 10,
  from: 0n,
  variables: (cursor) => ({ cursor }),
  key: (item) => item.id,
  stall: { tip: (item) => item.maxId },
  ...overrides,
});

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Lets every fiber that can run do so. Delivery, consumption and timers are all asynchronous to the test, and "nothing
 * happened" has no event to wait for, so the test yields a fixed number of macrotasks instead.
 */
const settle: Effect.Effect<void> = Effect.promise(nextMacrotask).pipe(Effect.repeatN(4));

/** Moves the clock and lets whatever that woke run. */
const advance = (duration: Duration.Duration): Effect.Effect<void> =>
  TestClock.adjust(duration).pipe(Effect.zipRight(settle));

/**
 * Consumes the wrapped stream in the background, recording the id of every event that reaches the consumer.
 *
 * @param feed The source to wrap.
 * @param wrapperOptions The wrapper's options.
 * @param handle What the consumer does with each event after recording it; a consumer that never returns holds the
 *   stream back.
 */
const consume = (
  feed: Feed,
  wrapperOptions: BackpressureOptions<Event, Variables> = options(),
  handle: Effect.Effect<void> = Effect.void,
) =>
  Effect.gen(function* () {
    const received = yield* Ref.make<readonly bigint[]>([]);
    const fiber = yield* withBackpressure(feed.source, wrapperOptions).pipe(
      Stream.runForEach((item) => Ref.update(received, (ids) => [...ids, item.id]).pipe(Effect.zipRight(handle))),
      Effect.fork,
    );
    yield* settle;
    return { fiber, received };
  });

/** The failure a settled stream ended with, or nothing if it is still running or ended any other way. */
const failureOf = <A, E>(settled: Option.Option<Exit.Exit<A, E>>): E | undefined =>
  settled.pipe(
    Option.flatMap((exit) => (Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none())),
    Option.getOrUndefined,
  );

const run = <A>(program: Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(program.pipe(Effect.provide(TestContext.TestContext)));

/**
 * A wrapper paused for backpressure while behind: the consumer holds the first event until `release` is completed, two
 * more fill the buffer, and the wrapper closes the session to stop the source.
 */
const pausedBehind = Effect.gen(function* () {
  const feed = makeFeed();
  const release = yield* Deferred.make<void>();
  const { fiber, received } = yield* consume(
    feed,
    options({ bufferSize: 2, resumeThreshold: 0 }),
    Deferred.await(release),
  );

  feed.deliver(event(1n, 100n));
  yield* settle;
  feed.deliver(event(2n, 100n));
  feed.deliver(event(3n, 100n));
  yield* settle;

  return { feed, fiber, received, release };
});

describe('withBackpressure stall detection', () => {
  it('should fail the stream once a session that is behind has delivered nothing for 30 seconds, because an open session that goes quiet never fails on its own', async () => {
    const observation = await run(
      Effect.gen(function* () {
        const feed = makeFeed();
        const { fiber, received } = yield* consume(feed);

        // Three events of ten: the source has said there is more, and then says nothing.
        [1n, 2n, 3n].forEach((id) => feed.deliver(event(id, 10n)));
        yield* settle;

        yield* advance(Duration.millis(29_999));
        const beforeTimeout = yield* Fiber.poll(fiber);
        yield* advance(Duration.millis(1));
        const atTimeout = yield* Fiber.poll(fiber);

        return {
          runningBeforeTimeout: Option.isNone(beforeTimeout),
          failureAtTimeout: failureOf(atTimeout),
          received: yield* Ref.get(received),
          disposals: feed.observed.disposals,
        };
      }),
    );

    expect(observation.runningBeforeTimeout).toBe(true);
    expect(observation.failureAtTimeout).toMatchObject({ _tag: 'SubscriptionStalledError', lastKey: 3n, tip: 10n });
    // Giving up on the session loses nothing it delivered, and closes it.
    expect(observation.received).toEqual([1n, 2n, 3n]);
    expect(observation.disposals).toBe(1);
  });

  it('should leave a silent session open when the last event it delivered was the tip, because a source with nothing left to deliver is silent too', async () => {
    const observation = await run(
      Effect.gen(function* () {
        const feed = makeFeed();
        const { fiber } = yield* consume(feed);

        [1n, 2n, 3n].forEach((id) => feed.deliver(event(id, 3n)));
        yield* settle;
        yield* advance(Duration.minutes(10));

        return { settled: yield* Fiber.poll(fiber), disposals: feed.observed.disposals };
      }),
    );

    expect(observation.settled).toEqual(Option.none());
    expect(observation.disposals).toBe(0);
  });

  it('should leave a session open that has delivered nothing when no tip is known, because a source that has never had an event has nothing to be behind', async () => {
    const observation = await run(
      Effect.gen(function* () {
        const feed = makeFeed();
        const { fiber } = yield* consume(feed);

        yield* advance(Duration.minutes(10));

        return { settled: yield* Fiber.poll(fiber), disposals: feed.observed.disposals };
      }),
    );

    expect(observation.settled).toEqual(Option.none());
    expect(observation.disposals).toBe(0);
  });

  it('should fail a session that delivers nothing in its first 30 seconds when a tip above its cursor is already known, because a session that is dead from its first frame reports no tip of its own', async () => {
    const observation = await run(
      Effect.gen(function* () {
        const feed = makeFeed();
        // Opened at five with ten already known to exist, as a stream replacing one that stalled would be.
        const { fiber } = yield* consume(
          feed,
          options({ from: 5n, stall: { tip: (item) => item.maxId, knownTip: 10n } }),
        );

        yield* advance(Duration.millis(29_999));
        const beforeTimeout = yield* Fiber.poll(fiber);
        yield* advance(Duration.millis(1));
        const atTimeout = yield* Fiber.poll(fiber);

        return {
          runningBeforeTimeout: Option.isNone(beforeTimeout),
          failureAtTimeout: failureOf(atTimeout),
          opened: [...feed.observed.opened],
          disposals: feed.observed.disposals,
        };
      }),
    );

    expect(observation.runningBeforeTimeout).toBe(true);
    expect(observation.failureAtTimeout).toMatchObject({ _tag: 'SubscriptionStalledError', lastKey: 5n, tip: 10n });
    expect(observation.opened).toEqual([5n]);
    expect(observation.disposals).toBe(1);
  });

  it('should leave a session open that has delivered up to the known tip and then goes silent, because it has caught up with everything known to exist', async () => {
    const observation = await run(
      Effect.gen(function* () {
        const feed = makeFeed();
        // Opened one below the tip it already holds, which is how a caught-up consumer asks for its boundary event.
        const { fiber, received } = yield* consume(
          feed,
          options({ from: 4n, stall: { tip: (item) => item.maxId, knownTip: 5n } }),
        );

        feed.deliver(event(5n, 5n));
        yield* settle;
        yield* advance(Duration.minutes(10));

        return {
          settled: yield* Fiber.poll(fiber),
          received: yield* Ref.get(received),
          disposals: feed.observed.disposals,
        };
      }),
    );

    expect(observation.settled).toEqual(Option.none());
    expect(observation.received).toEqual([5n]);
    expect(observation.disposals).toBe(0);
  });

  it('should take the tip an event reports over the one it was told at the start, because what an earlier stream saw says less about the source than the source itself does', async () => {
    const observation = await run(
      Effect.gen(function* () {
        const feed = makeFeed();
        // Told the timeline reaches ten, by a caller who saw that earlier; the source now says it ends at three.
        const { fiber, received } = yield* consume(
          feed,
          options({ stall: { tip: (item) => item.maxId, knownTip: 10n } }),
        );

        [1n, 2n, 3n].forEach((id) => feed.deliver(event(id, 3n)));
        yield* settle;
        yield* advance(Duration.minutes(10));

        return {
          settled: yield* Fiber.poll(fiber),
          received: yield* Ref.get(received),
          disposals: feed.observed.disposals,
        };
      }),
    );

    expect(observation.settled).toEqual(Option.none());
    expect(observation.received).toEqual([1n, 2n, 3n]);
    expect(observation.disposals).toBe(0);
  });

  it('should keep a session that is behind open for as long as events keep arriving within 30 seconds of each other, because only silence is a stall', async () => {
    const observation = await run(
      Effect.gen(function* () {
        const feed = makeFeed();
        const { fiber, received } = yield* consume(feed);

        feed.deliver(event(1n, 1_000n));
        yield* settle;

        // Two minutes behind in all, never more than twenty seconds without an event.
        yield* Effect.forEach([2n, 3n, 4n, 5n, 6n, 7n], (id) =>
          advance(Duration.seconds(20)).pipe(
            Effect.zipRight(Effect.sync(() => feed.deliver(event(id, 1_000n)))),
            Effect.zipRight(settle),
          ),
        );

        return {
          settled: yield* Fiber.poll(fiber),
          received: yield* Ref.get(received),
          disposals: feed.observed.disposals,
        };
      }),
    );

    expect(observation.settled).toEqual(Option.none());
    expect(observation.received).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n]);
    expect(observation.disposals).toBe(0);
  });

  it('should not give up on a session it paused for backpressure, because that silence is its own doing', async () => {
    const observation = await run(
      Effect.gen(function* () {
        const { feed, fiber } = yield* pausedBehind;
        const disposalsWhenPaused = feed.observed.disposals;

        yield* advance(Duration.minutes(10));

        return {
          disposalsWhenPaused,
          settled: yield* Fiber.poll(fiber),
          opened: [...feed.observed.opened],
          disposals: feed.observed.disposals,
        };
      }),
    );

    // The pause itself closed the one session; nothing was reopened or failed while it lasted.
    expect(observation.disposalsWhenPaused).toBe(1);
    expect(observation.settled).toEqual(Option.none());
    expect(observation.opened).toEqual([0n]);
    expect(observation.disposals).toBe(1);
  });

  it('should count from the moment a paused session is reopened, because a resumed session that stays silent is as dead as any other', async () => {
    const observation = await run(
      Effect.gen(function* () {
        const { feed, fiber, received, release } = yield* pausedBehind;

        // Paused for far longer than the timeout, then drained: the wrapper reopens from the last event it emitted.
        yield* advance(Duration.minutes(10));
        yield* Deferred.succeed(release, undefined);
        yield* settle;
        const openedAfterDrain = [...feed.observed.opened];

        yield* advance(Duration.millis(29_999));
        const beforeTimeout = yield* Fiber.poll(fiber);
        yield* advance(Duration.millis(1));
        const atTimeout = yield* Fiber.poll(fiber);

        return {
          openedAfterDrain,
          runningBeforeTimeout: Option.isNone(beforeTimeout),
          failureAtTimeout: failureOf(atTimeout),
          received: yield* Ref.get(received),
          disposals: feed.observed.disposals,
        };
      }),
    );

    expect(observation.openedAfterDrain).toEqual([0n, 3n]);
    expect(observation.runningBeforeTimeout).toBe(true);
    expect(observation.failureAtTimeout).toMatchObject({ _tag: 'SubscriptionStalledError', lastKey: 3n, tip: 100n });
    expect(observation.received).toEqual([1n, 2n, 3n]);
    // Once for the pause, once for the reopened session the wrapper gave up on.
    expect(observation.disposals).toBe(2);
  });
});
