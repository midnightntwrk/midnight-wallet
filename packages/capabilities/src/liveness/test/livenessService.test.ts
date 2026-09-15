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

/**
 * One chain, as the stubs model it: every block's hash is derived from its height, so both endpoints name the same
 * block wherever they are both asked, and a stub that answers with any other hash is on a different chain by
 * construction.
 */
const chainHash = (height: bigint): string => `0x${height.toString(16).padStart(64, '0')}`;

/** A block on that chain. */
const onChain = (height: bigint): IndexerLiveness.BlockRef => ({ height, hash: chainHash(height) });

/** Reads on one chain: matching genesis hashes, agreeing block hashes, and the given heights. */
const sameChainReads = (overrides: Partial<LivenessReads>): LivenessReads => ({
  indexerTip: () => Effect.succeed(onChain(1_000n)),
  finalizedBlock: () => Effect.succeed(onChain(1_000n)),
  indexerBlockHashAt: (height) => Effect.succeed(Option.some(chainHash(height))),
  nodeBlockHashAt: (height) => Effect.succeed(Option.some(chainHash(height))),
  indexerGenesisHash: () => Effect.succeed(INDEXER_GENESIS),
  nodeGenesisHash: () => Effect.succeed(NODE_GENESIS),
  ...overrides,
});

const fixedReads = (indexerHeight: bigint, finalizedHeight: bigint): LivenessReads =>
  sameChainReads({
    indexerTip: () => Effect.succeed(onChain(indexerHeight)),
    finalizedBlock: () => Effect.succeed(onChain(finalizedHeight)),
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
        finalizedBlock: () => Effect.fail(new LivenessReadError({ message: 'websocket closed' })),
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
        indexerTip: () => Effect.succeed(onChain(1_000n)),
        finalizedBlock: () =>
          Ref.getAndUpdate(diesOnce, (remaining) => (remaining > 0 ? remaining - 1 : 0)).pipe(
            Effect.flatMap((remaining) =>
              remaining > 0 ? Effect.die(new RangeError('not an integer')) : Effect.succeed(onChain(1_000n)),
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
        indexerTip: () => Effect.never,
        finalizedBlock: () => Effect.succeed(onChain(1_000n)),
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

  it('should publish Unavailable at the poll timeout even when the hung read cannot be interrupted', async () => {
    // A read that hangs inside an uninterruptible region — the node client's connection build is one — cannot be cut
    // short, and a timeout that interrupts and then awaits its loser inherits that wait: the bound becomes as soft as
    // the read is long. The verdict must still land at the deadline, with the read left to finish in the background.
    const program = Effect.gen(function* () {
      const reads = sameChainReads({
        finalizedBlock: () =>
          Effect.uninterruptible(Effect.sleep(Duration.minutes(1)).pipe(Effect.as(onChain(1_000n)))),
      });
      const service = yield* LivenessServiceImpl.make(reads, { ...tolerances, pollTimeout: Duration.seconds(5) });

      // A daemon, not a child: the test program must not wait on a poll that is still stuck at its end.
      const polling = yield* Effect.forkDaemon(service.startPolling(Stream.make(1)));
      yield* TestClock.adjust(Duration.seconds(5));
      // Let the timed-out poll run through to its verdict. The clock has not moved far enough for the read to finish.
      yield* Effect.yieldNow();
      yield* Effect.yieldNow();

      return { settled: yield* Fiber.poll(polling), verdict: yield* currentVerdict(service) };
    });

    const { settled, verdict } = await Effect.runPromise(program.pipe(Effect.provide(TestContext.TestContext)));

    expect(Option.isSome(settled)).toBe(true);
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

  it('should not republish InSync as the chain advances, so a healthy idle wallet is quiet between real changes', async () => {
    // On a live network both heights climb about five blocks per poll, so consecutive InSync verdicts are never
    // structurally equal — and a dedup keyed on structure let every poll fan a new wallet state out to every subscriber.
    const program = Effect.gen(function* () {
      // Mutable only as test setup: the chain advances five blocks between polls, indexer and node in step.
      const polls = yield* Ref.make(0n);
      const advancing = sameChainReads({
        indexerTip: () => Ref.getAndUpdate(polls, (n) => n + 1n).pipe(Effect.map((n) => onChain(1_000n + 5n * n))),
        finalizedBlock: () => Ref.get(polls).pipe(Effect.map((n) => onChain(1_000n + 5n * n))),
      });
      const service = yield* LivenessServiceImpl.make(advancing, tolerances);
      const seen = yield* Ref.make<readonly IndexerLiveness.IndexerLiveness[]>([]);
      const subscribed = yield* Deferred.make<void>();

      const subscriber = yield* Effect.fork(
        service.state().pipe(
          Stream.tap(() => Deferred.succeed(subscribed, undefined)),
          Stream.runForEach((verdict) => Ref.update(seen, (all) => [...all, verdict])),
        ),
      );
      yield* Deferred.await(subscribed);

      yield* service.startPolling(Stream.make(1, 2, 3));
      yield* Effect.sleep(Duration.millis(20));
      yield* Fiber.interrupt(subscriber);

      return yield* Ref.get(seen);
    });

    const seen = await Effect.runPromise(program);

    expect(seen.map((verdict) => verdict._tag)).toStrictEqual(['Unknown', 'InSync']);
  });

  it('should recover once a read succeeds again, so a transient outage leaves no trace', async () => {
    const program = Effect.gen(function* () {
      // Mutable only as test setup: the node read fails once, then succeeds.
      const failuresRemaining = yield* Ref.make(1);
      const reads = sameChainReads({
        indexerTip: () => Effect.succeed(onChain(1_000n)),
        finalizedBlock: () =>
          Ref.getAndUpdate(failuresRemaining, (remaining) => (remaining > 0 ? remaining - 1 : 0)).pipe(
            Effect.flatMap((remaining) =>
              remaining > 0
                ? Effect.fail(new LivenessReadError({ message: 'websocket closed' }))
                : Effect.succeed(onChain(1_000n)),
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

  it('should keep gating on Behind when a later poll fails, so a node outage cannot clear a proven stale view', async () => {
    // A Behind verdict is proof the indexer is stale; a failed poll after it proves nothing.
    // Replacing it with Unavailable, which does not gate, would let a pending waitForSyncedState() resolve over the
    // same stale indexer the first poll caught.
    const program = Effect.gen(function* () {
      // Mutable only as test setup: the node read answers once, then the endpoint goes away.
      const answersRemaining = yield* Ref.make(1);
      const reads = sameChainReads({
        indexerTip: () => Effect.succeed(onChain(900n)),
        finalizedBlock: () =>
          Ref.getAndUpdate(answersRemaining, (remaining) => (remaining > 0 ? remaining - 1 : 0)).pipe(
            Effect.flatMap((remaining) =>
              remaining > 0
                ? Effect.succeed(onChain(1_000n))
                : Effect.fail(new LivenessReadError({ message: 'websocket closed' })),
            ),
          ),
      });
      const service = yield* LivenessServiceImpl.make(reads, tolerances);

      yield* service.startPolling(Stream.make(1, 2));

      return yield* currentVerdict(service);
    });

    const verdict = await Effect.runPromise(program);

    expect(verdict).toStrictEqual(
      Option.some(IndexerLiveness.Behind({ indexerHeight: 900n, finalizedHeight: 1_000n, lag: 100n })),
    );
  });

  describe('genesis cross-check', () => {
    it('should pin WrongNetwork when the genesis hashes differ, never comparing heights on any poll', async () => {
      // A mismatch cannot heal: both hashes were read successfully and differ, and neither endpoint changes chain
      // until reconfigured. So the verdict is pinned — later polls neither re-read the hashes nor read heights, whose
      // comparison would be between two different chains and therefore meaningless.
      const calls = { heights: 0, genesis: 0 };
      const reads = sameChainReads({
        indexerTip: () => {
          calls.heights += 1;
          return Effect.succeed(onChain(1_000n));
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
            height: 0n,
            indexerBlockHash: Option.some('aa'.repeat(32)),
            nodeBlockHash: Option.some(`0x${'bb'.repeat(32)}`),
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

  describe('tip cross-check', () => {
    // A height is a number the indexer chooses. Comparing heights alone therefore only proves it can count — the block
    // at that height is the part it cannot invent, and both endpoints serve finalized blocks, so a disagreement about
    // one is conclusive rather than a transient difference of view.
    const OTHER_CHAIN = `0x${'99'.repeat(32)}`;

    it('should publish WrongNetwork when the two tips are at the same height but name different blocks', async () => {
      const reads = sameChainReads({
        indexerTip: () => Effect.succeed({ height: 1_000n, hash: OTHER_CHAIN }),
        finalizedBlock: () => Effect.succeed(onChain(1_000n)),
      });

      const verdict = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* LivenessServiceImpl.make(reads, tolerances);
          yield* service.startPolling(Stream.make('tick'));
          return yield* currentVerdict(service);
        }),
      );

      expect(verdict).toStrictEqual(
        Option.some(
          IndexerLiveness.WrongNetwork({
            height: 1_000n,
            indexerBlockHash: Option.some(OTHER_CHAIN),
            nodeBlockHash: Option.some(chainHash(1_000n)),
          }),
        ),
      );
    });

    it('should publish WrongNetwork when the indexer leads and names a different block at the finalized height', async () => {
      // The overshoot is inside the tolerance, so a height-only check would have called this InSync.
      const reads = sameChainReads({
        indexerTip: () => Effect.succeed(onChain(1_002n)),
        finalizedBlock: () => Effect.succeed(onChain(1_000n)),
        indexerBlockHashAt: () => Effect.succeed(Option.some(OTHER_CHAIN)),
      });

      const verdict = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* LivenessServiceImpl.make(reads, tolerances);
          yield* service.startPolling(Stream.make('tick'));
          return yield* currentVerdict(service);
        }),
      );

      expect(verdict).toStrictEqual(
        Option.some(
          IndexerLiveness.WrongNetwork({
            height: 1_000n,
            indexerBlockHash: Option.some(OTHER_CHAIN),
            nodeBlockHash: Option.some(chainHash(1_000n)),
          }),
        ),
      );
    });

    it('should publish WrongNetwork when the indexer cannot name a block it claims to have passed', async () => {
      // Reporting height 1_002 is a claim to have ingested block 1_000. Being unable to serve it contradicts that
      // claim, so it gates like any other mismatch rather than passing as an unreadable answer.
      const reads = sameChainReads({
        indexerTip: () => Effect.succeed(onChain(1_002n)),
        finalizedBlock: () => Effect.succeed(onChain(1_000n)),
        indexerBlockHashAt: () => Effect.succeed(Option.none()),
      });

      const verdict = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* LivenessServiceImpl.make(reads, tolerances);
          yield* service.startPolling(Stream.make('tick'));
          return yield* currentVerdict(service);
        }),
      );

      expect(verdict).toStrictEqual(
        Option.some(
          IndexerLiveness.WrongNetwork({
            height: 1_000n,
            indexerBlockHash: Option.none(),
            nodeBlockHash: Option.some(chainHash(1_000n)),
          }),
        ),
      );
    });

    it('should publish WrongNetwork when the indexer trails and the node does not confirm its tip', async () => {
      const reads = sameChainReads({
        indexerTip: () => Effect.succeed({ height: 995n, hash: OTHER_CHAIN }),
        finalizedBlock: () => Effect.succeed(onChain(1_000n)),
      });

      const verdict = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* LivenessServiceImpl.make(reads, tolerances);
          yield* service.startPolling(Stream.make('tick'));
          return yield* currentVerdict(service);
        }),
      );

      expect(verdict).toStrictEqual(
        Option.some(
          IndexerLiveness.WrongNetwork({
            height: 995n,
            indexerBlockHash: Option.some(OTHER_CHAIN),
            nodeBlockHash: Option.some(chainHash(995n)),
          }),
        ),
      );
    });

    it('should ask the endpoint that is ahead for the shared block, and only that one', async () => {
      // The endpoint that trails is already reporting the shared block as its own tip, so asking it again would be a
      // second round trip for an answer already in hand.
      const asked = { indexer: [] as bigint[], node: [] as bigint[] };
      const reads = sameChainReads({
        indexerTip: () => Effect.succeed(onChain(1_002n)),
        finalizedBlock: () => Effect.succeed(onChain(1_000n)),
        indexerBlockHashAt: (height) => {
          asked.indexer = [...asked.indexer, height];
          return Effect.succeed(Option.some(chainHash(height)));
        },
        nodeBlockHashAt: (height) => {
          asked.node = [...asked.node, height];
          return Effect.succeed(Option.some(chainHash(height)));
        },
      });

      const verdict = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* LivenessServiceImpl.make(reads, tolerances);
          yield* service.startPolling(Stream.make('tick'));
          return yield* currentVerdict(service);
        }),
      );

      expect(verdict).toStrictEqual(
        Option.some(IndexerLiveness.InSync({ indexerHeight: 1_002n, finalizedHeight: 1_000n })),
      );
      expect(asked.indexer).toStrictEqual([1_000n]);
      expect(asked.node).toStrictEqual([]);
    });

    it('should read no extra block when the heights are equal, because the two tips are already that block', async () => {
      const asked = { indexer: 0, node: 0 };
      const reads = sameChainReads({
        indexerBlockHashAt: (height) => {
          asked.indexer += 1;
          return Effect.succeed(Option.some(chainHash(height)));
        },
        nodeBlockHashAt: (height) => {
          asked.node += 1;
          return Effect.succeed(Option.some(chainHash(height)));
        },
      });

      const verdict = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* LivenessServiceImpl.make(reads, tolerances);
          yield* service.startPolling(Stream.make('tick'));
          return yield* currentVerdict(service);
        }),
      );

      expect(verdict).toStrictEqual(
        Option.some(IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n })),
      );
      expect(asked).toStrictEqual({ indexer: 0, node: 0 });
    });

    it('should still report Behind when the endpoints agree on the shared block but the lag exceeds the tolerance', async () => {
      // Agreement clears the way for the height comparison; it does not excuse a stale indexer.
      const verdict = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* LivenessServiceImpl.make(fixedReads(900n, 1_000n), tolerances);
          yield* service.startPolling(Stream.make('tick'));
          return yield* currentVerdict(service);
        }),
      );

      expect(verdict).toStrictEqual(
        Option.some(IndexerLiveness.Behind({ indexerHeight: 900n, finalizedHeight: 1_000n, lag: 100n })),
      );
    });

    it('should keep a proven tip mismatch when a later poll fails, so an outage cannot clear it', async () => {
      // The mismatch was proven by two successful reads of finalized blocks. A poll that cannot complete disproves
      // nothing, and replacing the verdict with Unavailable — which does not gate — would release a caller waiting on
      // an indexer serving another chain.
      const program = Effect.gen(function* () {
        // Mutable only as test setup: the node answers once, then the endpoint goes away.
        const answersRemaining = yield* Ref.make(1);
        const reads = sameChainReads({
          indexerTip: () => Effect.succeed({ height: 1_000n, hash: OTHER_CHAIN }),
          finalizedBlock: () =>
            Ref.getAndUpdate(answersRemaining, (remaining) => (remaining > 0 ? remaining - 1 : 0)).pipe(
              Effect.flatMap((remaining) =>
                remaining > 0
                  ? Effect.succeed(onChain(1_000n))
                  : Effect.fail(new LivenessReadError({ message: 'websocket closed' })),
              ),
            ),
        });
        const service = yield* LivenessServiceImpl.make(reads, tolerances);

        yield* service.startPolling(Stream.make(1, 2));

        return yield* currentVerdict(service);
      });

      const verdict = await Effect.runPromise(program);

      expect(verdict).toStrictEqual(
        Option.some(
          IndexerLiveness.WrongNetwork({
            height: 1_000n,
            indexerBlockHash: Option.some(OTHER_CHAIN),
            nodeBlockHash: Option.some(chainHash(1_000n)),
          }),
        ),
      );
    });
  });
});
