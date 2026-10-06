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
import { Array as EArray, Chunk, Deferred, Effect, Fiber, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { type BackpressureOptions, type Source, withBackpressure } from '../Backpressure.js';

// These tests drive the real stream wrapper, not the pure reducers covered in backpressure.test.ts. Without the
// pause, a wallet catching up on a long chain buffers every event the indexer pushes faster than it can apply them,
// and its heap grows with how far behind it is.

type Variables = { readonly cursor: bigint };

type Session = {
  readonly cursor: bigint;
  // The highest key any earlier session delivered, which a correct resume reopens at.
  readonly maxKeyAtOpen: bigint;
  // Unconsumed items (new keys delivered by the source, not yet handled by the consumer) when this session opened.
  readonly unconsumedAtOpen: number;
};

/**
 * Observations made by the fake source and the consumer. Mutable by necessity: it records what an inherently
 * push-based, callback-driven API did, from inside its callbacks.
 */
type Log = {
  readonly sessions: Session[];
  disposals: number;
  // Every item the source delivered, including the boundary item each inclusive-cursor resume repeats.
  delivered: number;
  // Only keys not delivered before: the items the consumer is owed.
  fresh: number;
  consumed: number;
  peakUnconsumed: number;
  maxDeliveredKey: bigint;
};

const newLog = (): Log => ({
  sessions: [],
  disposals: 0,
  delivered: 0,
  fresh: 0,
  consumed: 0,
  peakUnconsumed: 0,
  maxDeliveredKey: 0n,
});

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * A source over the keys `1..total` with an inclusive cursor, like the indexer's event subscriptions: opened at cursor
 * `c` it re-delivers `c` itself (when `c >= 1`) and then everything after it. It delivers one item per macrotask, the
 * way WebSocket frames arrive, and honours the {@link Source} contract by delivering nothing once disposed.
 */
const fakeSource =
  (total: bigint, log: Log): Source<bigint, Variables, never> =>
  ({ variables, onItem, onComplete }) => {
    const state = { disposed: false, next: variables.cursor < 1n ? 1n : variables.cursor };
    log.sessions.push({
      cursor: variables.cursor,
      maxKeyAtOpen: log.maxDeliveredKey,
      unconsumedAtOpen: log.fresh - log.consumed,
    });

    const step = (): void => {
      if (state.disposed) return;
      if (state.next > total) {
        onComplete();
        return;
      }
      const key = state.next;
      state.next = key + 1n;
      log.delivered += 1;
      if (key > log.maxDeliveredKey) {
        log.fresh += 1;
        log.maxDeliveredKey = key;
      }
      log.peakUnconsumed = Math.max(log.peakUnconsumed, log.fresh - log.consumed);
      onItem(key);
      setImmediate(step);
    };
    setImmediate(step);

    return () => {
      state.disposed = true;
      log.disposals += 1;
    };
  };

const options = (bufferSize: number, resumeThreshold: number): BackpressureOptions<bigint, Variables> => ({
  bufferSize,
  resumeThreshold,
  from: 0n,
  variables: (cursor) => ({ cursor }),
  key: (item) => item,
});

/** Resolves once the source has gone `quietFor` macrotasks without delivering anything. */
const sourceQuiescent = async (log: Log, quietFor = 50): Promise<void> => {
  const settle = async (lastDelivered: number, quiet: number): Promise<void> => {
    if (quiet >= quietFor) return;
    await nextMacrotask();
    return settle(log.delivered, log.delivered === lastDelivered ? quiet + 1 : 0);
  };
  return settle(log.delivered, 0);
};

describe('withBackpressure', () => {
  const bufferSize = 10;
  const resumeThreshold = 3;
  // Long enough that an unbounded queue is unmistakable next to the bound.
  const total = 200n;

  it('stops the source once the consumer falls bufferSize behind, and keeps no more than that queued', async () => {
    const log = newLog();
    const release = Effect.runSync(Deferred.make<void>());

    // The consumer takes the first item and then stalls, so everything after it can only queue up.
    const run = withBackpressure(fakeSource(total, log), options(bufferSize, resumeThreshold)).pipe(
      Stream.mapEffect((item) =>
        Effect.sync(() => {
          log.consumed += 1;
        }).pipe(Effect.zipRight(Deferred.await(release)), Effect.as(item)),
      ),
      Stream.runDrain,
      Effect.runFork,
    );

    await sourceQuiescent(log);

    // The item held by the stalled consumer was handed to it, so it is the one item above bufferSize.
    expect(log.disposals).toBe(1);
    expect(log.delivered).toBeLessThanOrEqual(bufferSize + 1);
    expect(log.peakUnconsumed).toBeLessThanOrEqual(bufferSize + 1);
    expect(log.delivered).toBeLessThan(Number(total));

    await Effect.runPromise(Fiber.interrupt(run));
  });

  it('closes the live source session when the consumer stops early', async () => {
    const log = newLog();

    const taken = await withBackpressure(fakeSource(total, log), options(bufferSize, resumeThreshold)).pipe(
      Stream.take(3),
      Stream.runCollect,
      Effect.runPromise,
    );
    const deliveredAtClose = log.delivered;
    await sourceQuiescent(log, 20);

    expect(Chunk.toReadonlyArray(taken)).toEqual([1n, 2n, 3n]);
    expect(log.disposals).toBe(log.sessions.length);
    // Nothing reaches the closed session afterwards.
    expect(log.delivered).toBe(deliveredAtClose);
  });

  it('resumes from the last emitted key after draining, delivering every key exactly once across many pauses', async () => {
    const log = newLog();

    // The consumer takes three macrotasks per item against the source's one, so it keeps falling behind and the
    // source is paused and resumed over and over.
    const received = await withBackpressure(fakeSource(total, log), options(bufferSize, resumeThreshold)).pipe(
      Stream.tap(() =>
        Effect.promise(async () => {
          // A resume is opened from this tap's drain accounting, before the consumer has finished with the item, so
          // the bookkeeping must happen before awaiting.
          log.consumed += 1;
          await nextMacrotask();
          await nextMacrotask();
          await nextMacrotask();
        }),
      ),
      Stream.runCollect,
      Effect.map(Chunk.toReadonlyArray),
      Effect.runPromise,
    );

    expect(received).toEqual(EArray.makeBy(Number(total), (i) => BigInt(i + 1)));

    const resumes = log.sessions.slice(1);
    expect(log.sessions[0]?.cursor).toBe(0n);
    expect(resumes.length).toBeGreaterThanOrEqual(5);
    expect(log.disposals).toBeGreaterThanOrEqual(resumes.length);
    resumes.forEach((session) => {
      // Reopened from where it left off, not from the start: with an inclusive cursor only the boundary item is
      // delivered twice.
      expect(session.cursor).toBe(session.maxKeyAtOpen);
      // And only once the consumer had drained to the threshold (plus the item it is holding).
      expect(session.unconsumedAtOpen).toBeLessThanOrEqual(resumeThreshold + 1);
    });
    // Each resume cursor is the previous session's last key, so the source re-sends one item per resume and no more.
    expect(log.delivered).toBe(Number(total) + resumes.length);
    expect(log.peakUnconsumed).toBeLessThanOrEqual(bufferSize + 1);
  });
});
