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
import { IndexerLiveness } from '@midnightntwrk/wallet-sdk-abstractions';
import { Deferred, Duration, Effect, Fiber, Option, Ref, Stream, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import { type LivenessReads, LivenessReadError, LivenessServiceImpl } from '../livenessService.js';

const tolerances = { maxBehindBlocks: 10n, maxAheadBlocks: 10n };

/** Reads that always report the same two heights. */
// The same genesis bytes in each side's own presentation — the node 0x-prefixed, the indexer bare — so every test
// that uses these stubs also exercises the normalisation a real pairing depends on.
const INDEXER_GENESIS = 'ab'.repeat(32);
const NODE_GENESIS = `0x${'ab'.repeat(32)}`;

/** Reads on one chain: matching genesis hashes and the given heights. */
const sameChainReads = (overrides: Partial<LivenessReads>): LivenessReads => ({
  indexerHeight: () => Effect.succeed(1_000n),
  finalizedHeight: () => Effect.succeed(1_000n),
  indexerGenesisHash: () => Effect.succeed(INDEXER_GENESIS),
  nodeGenesisHash: () => Effect.succeed(NODE_GENESIS),
  ...overrides,
});

const fixedReads = (indexerHeight: bigint, finalizedHeight: bigint): LivenessReads =>
  sameChainReads({
    indexerHeight: () => Effect.succeed(indexerHeight),
    finalizedHeight: () => Effect.succeed(finalizedHeight),
  });

/** The verdict currently published by the service. */
const currentVerdict = (service: LivenessServiceImpl) => Stream.runHead(service.state());

describe('LivenessServiceImpl', () => {
  it('should report Unknown before any tick, because a check exists but has not run', async () => {
    const program = Effect.gen(function* () {
      const service = yield* LivenessServiceImpl.make(fixedReads(1_000n, 1_000n), tolerances);

      return yield* currentVerdict(service);
    });

    const verdict = await Effect.runPromise(program);

    expect(verdict).toStrictEqual(Option.some(IndexerLiveness.Unknown()));
  });

  it('should publish a verdict on each tick', async () => {
    const program = Effect.gen(function* () {
      const service = yield* LivenessServiceImpl.make(fixedReads(1_000n, 1_000n), tolerances);

      yield* service.startPolling(Stream.make(1));

      return yield* currentVerdict(service);
    });

    const verdict = await Effect.runPromise(program);

    expect(verdict).toStrictEqual(
      Option.some(IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n })),
    );
  });

  it('should publish Unavailable when a read fails, rather than failing the polling loop', async () => {
    // A liveness check that gave up on its first network error would be useless against exactly the conditions it
    // exists to detect, so `startPolling` cannot fail.
    const program = Effect.gen(function* () {
      const reads = sameChainReads({
        finalizedHeight: () => Effect.fail(new LivenessReadError({ message: 'websocket closed' })),
      });
      const service = yield* LivenessServiceImpl.make(reads, tolerances);

      yield* service.startPolling(Stream.make(1));

      return yield* currentVerdict(service);
    });

    const verdict = await Effect.runPromise(program);

    expect(verdict).toStrictEqual(
      Option.some(IndexerLiveness.Unavailable({ consecutiveFailures: 1, lastError: 'websocket closed' })),
    );
  });

  it('should survive a read that dies, because a defect must not silently disable the check', async () => {
    // `catchAll` folds only the typed channel. A read can also die — a malformed indexer payload, an unparsed URL — and
    // if that kills the poll fibre the verdict freezes at whatever was last written, which at start-up is `Unknown` and
    // never gates. An indexer able to disable the check by returning bad data defeats the point of having one.
    const program = Effect.gen(function* () {
      const diesOnce = yield* Ref.make(1);
      const reads = sameChainReads({
        indexerHeight: () => Effect.succeed(1_000n),
        finalizedHeight: () =>
          Ref.getAndUpdate(diesOnce, (remaining) => (remaining > 0 ? remaining - 1 : 0)).pipe(
            Effect.flatMap((remaining) =>
              remaining > 0 ? Effect.die(new RangeError('not an integer')) : Effect.succeed(1_000n),
            ),
          ),
      });
      const service = yield* LivenessServiceImpl.make(reads, tolerances);

      yield* service.startPolling(Stream.make(1));
      const afterDefect = yield* currentVerdict(service);

      // The second tick proves the loop is still running, not merely that the first defect was caught.
      yield* service.startPolling(Stream.make(2));
      const afterRecovery = yield* currentVerdict(service);

      return { afterDefect, afterRecovery };
    });

    const { afterDefect, afterRecovery } = await Effect.runPromise(program);

    expect(Option.getOrThrow(afterDefect)._tag).toBe('Unavailable');
    expect(afterRecovery).toStrictEqual(
      Option.some(IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n })),
    );
  });

  it('should bound the whole poll, so a read that hangs becomes Unavailable instead of freezing the loop', async () => {
    // Only the node read carried its own deadline. An indexer endpoint that accepts a connection and never answers
    // hung the poll forever: `startPolling` runs one poll at a time, so the loop stopped, the verdict froze at
    // whatever was published last — and if that was `InSync`, a wallet reported itself synchronized indefinitely
    // while its indexer stalled. A hung read must not be able to switch the check off.
    const program = Effect.gen(function* () {
      const reads = sameChainReads({
        indexerHeight: () => Effect.never,
        finalizedHeight: () => Effect.succeed(1_000n),
      });
      const service = yield* LivenessServiceImpl.make(reads, {
        ...tolerances,
        pollTimeout: Duration.seconds(5),
      });

      const polling = yield* Effect.fork(service.startPolling(Stream.make(1)));
      yield* TestClock.adjust(Duration.seconds(5));
      yield* Fiber.join(polling);

      return yield* currentVerdict(service);
    });

    const verdict = await Effect.runPromise(program.pipe(Effect.provide(TestContext.TestContext)));

    expect(Option.getOrThrow(verdict)._tag).toBe('Unavailable');
  });

  it('should publish a verdict only when it changes, so an idle wallet is not re-notified every poll', async () => {
    // Every poll wrote its verdict unconditionally, and that write fans out into the wallet's full state stream — so
    // a healthy, idle wallet re-published its entire state to every subscriber once per poll, forever. Verdicts are
    // structural data, so consecutive equals are dropped; `Unavailable`'s climbing failure count still differs poll
    // to poll, so a lengthening outage keeps reporting.
    const program = Effect.gen(function* () {
      const service = yield* LivenessServiceImpl.make(fixedReads(1_000n, 1_000n), tolerances);
      const seen = yield* Ref.make<readonly IndexerLiveness.IndexerLiveness[]>([]);
      const subscribed = yield* Deferred.make<void>();

      const subscriber = yield* Effect.fork(
        service.state().pipe(
          Stream.tap(() => Deferred.succeed(subscribed, undefined)),
          Stream.runForEach((verdict) => Ref.update(seen, (all) => [...all, verdict])),
        ),
      );
      // The replayed initial verdict proves the subscription is live before any poll runs.
      yield* Deferred.await(subscribed);

      yield* service.startPolling(Stream.make(1, 2, 3));
      // Let the subscriber drain everything the three polls enqueued before reading the log.
      yield* Effect.sleep(Duration.millis(20));
      yield* Fiber.interrupt(subscriber);

      return yield* Ref.get(seen);
    });

    const seen = await Effect.runPromise(program);

    expect(seen).toStrictEqual([
      IndexerLiveness.Unknown(),
      IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n }),
    ]);
  });

  it('should recover once a read succeeds again, so a transient outage leaves no trace', async () => {
    const program = Effect.gen(function* () {
      // Mutable only as test setup: the node read fails once, then succeeds.
      const failuresRemaining = yield* Ref.make(1);
      const reads = sameChainReads({
        indexerHeight: () => Effect.succeed(1_000n),
        finalizedHeight: () =>
          Ref.getAndUpdate(failuresRemaining, (remaining) => (remaining > 0 ? remaining - 1 : 0)).pipe(
            Effect.flatMap((remaining) =>
              remaining > 0
                ? Effect.fail(new LivenessReadError({ message: 'websocket closed' }))
                : Effect.succeed(1_000n),
            ),
          ),
      });
      const service = yield* LivenessServiceImpl.make(reads, tolerances);

      yield* service.startPolling(Stream.make(1, 2));

      return yield* currentVerdict(service);
    });

    const verdict = await Effect.runPromise(program);

    expect(verdict).toStrictEqual(
      Option.some(IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n })),
    );
  });

  describe('genesis cross-check', () => {
    it('should pin WrongNetwork when the genesis hashes differ, never comparing heights on any poll', async () => {
      // A mismatch cannot heal: both hashes were read successfully and differ, and neither endpoint changes chain
      // until reconfigured. So the verdict is pinned — later polls neither re-read the hashes nor read heights, whose
      // comparison would be between two different chains and therefore meaningless.
      const calls = { heights: 0, genesis: 0 };
      const reads = sameChainReads({
        indexerHeight: () => {
          calls.heights += 1;
          return Effect.succeed(1_000n);
        },
        indexerGenesisHash: () => {
          calls.genesis += 1;
          return Effect.succeed('aa'.repeat(32));
        },
        nodeGenesisHash: () => Effect.succeed(`0x${'bb'.repeat(32)}`),
      });

      const verdict = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* LivenessServiceImpl.make(reads, tolerances);
          yield* service.startPolling(Stream.make('tick', 'tick', 'tick'));
          return yield* currentVerdict(service);
        }),
      );

      expect(verdict).toStrictEqual(
        Option.some(
          IndexerLiveness.WrongNetwork({
            indexerGenesisHash: 'aa'.repeat(32),
            nodeGenesisHash: `0x${'bb'.repeat(32)}`,
          }),
        ),
      );
      expect(calls.genesis).toBe(1);
      expect(calls.heights).toBe(0);
    });

    it('should verify the chain identity once, then compare only heights on later polls', async () => {
      const calls = { genesis: 0 };
      const reads = sameChainReads({
        indexerGenesisHash: () => {
          calls.genesis += 1;
          return Effect.succeed(INDEXER_GENESIS);
        },
      });

      const verdict = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* LivenessServiceImpl.make(reads, tolerances);
          yield* service.startPolling(Stream.make('tick', 'tick', 'tick'));
          return yield* currentVerdict(service);
        }),
      );

      expect(verdict).toStrictEqual(
        Option.some(IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n })),
      );
      expect(calls.genesis).toBe(1);
    });

    it('should report a failed genesis read as Unavailable and retry it on the next poll', async () => {
      // Failing to read a hash proves nothing about which chain anyone is on, so it must not pin anything — unlike a
      // successful read of two different hashes.
      const attempts = { count: 0 };
      const reads = sameChainReads({
        indexerGenesisHash: () => {
          attempts.count += 1;
          return attempts.count === 1
            ? Effect.fail(new LivenessReadError({ message: 'indexer answered garbage' }))
            : Effect.succeed(INDEXER_GENESIS);
        },
      });

      const verdicts = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* LivenessServiceImpl.make(reads, tolerances);
          yield* service.startPolling(Stream.make('tick'));
          const afterFailure = yield* currentVerdict(service);
          yield* service.startPolling(Stream.make('tick'));
          const afterRecovery = yield* currentVerdict(service);
          return { afterFailure, afterRecovery };
        }),
      );

      expect(verdicts.afterFailure).toStrictEqual(
        Option.some(IndexerLiveness.Unavailable({ consecutiveFailures: 1, lastError: 'indexer answered garbage' })),
      );
      expect(verdicts.afterRecovery).toStrictEqual(
        Option.some(IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n })),
      );
      expect(attempts.count).toBe(2);
    });
  });
});
