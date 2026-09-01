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
 * Starting a dust wallet that was restored from a snapshot, and what that start has to be able to answer for.
 *
 * @remarks
 *   `forkRestore.test.ts` says which variant a snapshot lands on. This is the question that follows it: a restored wallet
 *   holds no key material at all — snapshots deliberately contain none — so it synchronizes nothing until it is started
 *   again, and what it can be started _with_ is decided by the variant the snapshot put it on.
 *
 *   A snapshot written below the boundary restores onto the pre-fork variant, whose synchronization needs the pre-fork
 *   ledger version's `DustSecretKey`. The post-fork key `start` takes is the one this wallet's public API speaks, and
 *   it is the wrong runtime's for that variant — so the two starts that answer for _both_ sides are the instance's
 *   `startWithSeed` and `startWithKeys`, and they are what a wallet restored below the boundary is started with. Doing
 *   so is the whole of the fix: the wallet finishes the pre-fork stretch of the timeline it had not read, crosses the
 *   fork, and re-discovers its dust from the replay.
 *
 *   The refusal is kept as a permanent negative beside them. A single post-fork key cannot serve a pre-fork variant and
 *   must not appear to: the wallet says so by name, and names the two instance starts that would have worked.
 *
 *   The last case is the one that already worked and must go on working: a snapshot written at or past the boundary
 *   restores onto the post-fork variant, whose ledger version is the one `start` speaks, so a single key is all it
 *   needs.
 */

import { LedgerParameters as PreForkLedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { StartMaterial } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { Cause, Deferred, Effect, Option, Queue, Runtime, type Scope, Stream, pipe } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { peekProtocolVersion } from '../Restore.js';
import { V1Tag } from '../v1/RunningV1Variant.js';
import { DUST_EVENT_COUNT, type DustChain, buildDustChain, dustSeed } from '../v1/test/dustEvents.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import { dustParameters as postForkDustParameters } from '../v2/test/dustEvents.js';
import { type ForkWallet, type ForkedState, makeForkWallet } from './forkHarness.js';
import { type TimelineEvent, numberedFrom } from './forkReplay.js';
import {
  balanceAt,
  commitmentTreeRoot,
  dustCount,
  dustIdentities,
  generationTreeRoot,
} from './forkWalletAssertions.js';

// Building a real dust chain (rewards + registrations through WASM) does not fit vitest's 5s default on a CI runner.
vi.setConfig({ testTimeout: 60_000 });

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its post-fork variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has already forked — past the boundary rather than exactly at it. */
const afterFork = ProtocolVersion.ProtocolVersion(9n);
/** A chain that has not — a version the pre-fork variant owns. */
const beforeFork = ProtocolVersion.ProtocolVersion(5n);

const dustParameters = {
  preFork: PreForkLedgerParameters.initialParameters().dust,
  postFork: postForkDustParameters(),
};

/**
 * How much of the pre-fork timeline the snapshot was written over.
 *
 * @remarks
 *   Deliberately short of the whole of it: what the restored wallet is asked to do below is finish reading a stretch of
 *   timeline the snapshot never saw, which is the ordinary reason an application restores at all.
 */
const snapshotStretch = 2;

/**
 * The event id the replay opens at.
 *
 * One past the pre-fork history, because there is only one id space: the indexer numbers its replay onwards from the id
 * it had reached when the fork happened.
 */
const boundaryId = DUST_EVENT_COUNT + 1;

/** Where the replay ends, and so where a wallet that consumed all of it lands. */
const replayEndId = boundaryId + DUST_EVENT_COUNT - 1;

/** A probe answering as a chain on `version` would. */
const chainReporting =
  (version: ProtocolVersion.ProtocolVersion): ChainVersionProbe =>
  () =>
    Promise.resolve(version);

/** The tag of the variant a wallet is running, read the way the harness reads it of the wallet it started. */
const runningTag = (wallet: ForkWallet['dust']): Effect.Effect<string | symbol> =>
  pipe(
    wallet.runtime.currentVariant,
    Effect.map((current) => current.runningVariant.__polyTag__),
  );

/**
 * The first state a restored wallet publishes that satisfies `predicate`, read off the runtime.
 *
 * Monotone predicates only: the stream keeps just the latest value.
 */
const restoredStates = (wallet: ForkWallet['dust'], predicate: (state: ForkedState) => boolean) =>
  pipe(
    wallet.runtime.stateChanges,
    Stream.filter(predicate),
    Stream.take(1),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

/**
 * The typed failure a wallet call rejected with.
 *
 * @remarks
 *   The wallet's API is promise-shaped and its failures are effect failures, so a rejection carries the cause rather than
 *   the error itself. A call that resolves reports `None`, which fails the assertion below rather than reading a
 *   property off nothing.
 */
const failureOf = (call: Promise<unknown>): Effect.Effect<Option.Option<unknown>> =>
  Effect.promise(() =>
    call.then(
      () => Option.none<unknown>(),
      (rejection: unknown) =>
        Runtime.isFiberFailure(rejection)
          ? Cause.failureOption(rejection[Runtime.FiberFailureCauseId])
          : Option.some(rejection),
    ),
  );

/** A wallet that read the opening stretch of a pre-fork timeline, and the snapshot it wrote there. */
type SnapshotBelow = Readonly<{
  chain: DustChain;
  wallet: ForkWallet;
  snapshot: string;
  /** The pre-fork wire, still open: what the restored wallet reads the rest of the timeline from. */
  wire: Queue.Queue<readonly TimelineEvent[]>;
  /** The replay, still unfulfilled: what the post-fork variant reads once the fork has happened. */
  replayed: Deferred.Deferred<readonly TimelineEvent[]>;
  /** The whole pre-fork history, of which the snapshot covers only {@link snapshotStretch} events. */
  history: readonly TimelineEvent[];
  /** The same events again, renumbered from the boundary and reported at the post-fork version. */
  replay: readonly TimelineEvent[];
}>;

const snapshotBelowTheBoundary: Effect.Effect<SnapshotBelow, unknown, Scope.Scope> = Effect.gen(function* () {
  const chain = yield* Effect.promise(() => buildDustChain());
  const history = numberedFrom(chain.eventBytes, 1, Number(beforeFork));
  const replay = numberedFrom(chain.eventBytes, boundaryId, Number(forkVersion));
  const wire = yield* Queue.unbounded<readonly TimelineEvent[]>();
  const replayed = yield* Deferred.make<readonly TimelineEvent[]>();

  const wallet = yield* makeForkWallet({
    preFork: Stream.fromQueue(wire),
    replayed: Deferred.await(replayed),
    networkId,
    forkVersion,
    seed: dustSeed(),
    dustParameters,
    syncTime: chain.syncTime,
  });
  yield* Effect.addFinalizer(() => wallet.stop);
  yield* wallet.start;

  yield* Queue.offer(wire, history.slice(0, snapshotStretch));
  const synced = yield* wallet.awaitState((state) => dustCount(state.state) === snapshotStretch);
  expect(yield* wallet.activeTag).toBe(V1Tag);
  expect(synced.state.protocolVersion).toBeLessThan(forkVersion);

  const snapshot = yield* Effect.promise(() => wallet.dust.serializeState());
  expect(Option.getOrThrow(peekProtocolVersion(snapshot))).toBeLessThan(forkVersion);

  // The wire has one consumer at a time, as an indexer subscription does. Stopping the wallet that wrote the snapshot
  // is what an application restoring one has already done, and it is what leaves the rest of the timeline for the
  // wallet under test rather than splitting it between the two.
  yield* wallet.stop;

  return { chain, wallet, snapshot, wire, replayed, history, replay };
});

/**
 * Everything a wallet restored below the boundary and started with material for both sides has to do.
 *
 * @remarks
 *   Both halves matter and neither implies the other. First it finishes the pre-fork stretch — proving it was started at
 *   all, on a variant whose ledger version the wallet's own API does not speak. Then it crosses and re-discovers, from
 *   the replay, exactly the dust it was holding on the other side.
 */
const finishesThePreForkStretchAndCrosses = (restored: ForkWallet['dust'], below: SnapshotBelow) =>
  Effect.gen(function* () {
    expect(yield* runningTag(restored)).toBe(V1Tag);

    // The whole history, as an indexer resuming a subscription would serve it: the cursor the snapshot carries is what
    // decides which of it is new.
    yield* Queue.offer(below.wire, below.history);
    const caughtUp = yield* restoredStates(restored, (state) => dustCount(state.state) === DUST_EVENT_COUNT);
    expect(caughtUp.state.protocolVersion).toBeLessThan(forkVersion);
    expect(caughtUp.state.progress.appliedIndex).toBe(BigInt(DUST_EVENT_COUNT));
    expect(yield* runningTag(restored)).toBe(V1Tag);

    // Everything it knows, recorded before the hand-over destroys the ledger-v8 objects holding it.
    const preForkDust = dustIdentities(caughtUp.state);
    const preForkCommitmentRoot = commitmentTreeRoot(caughtUp.state);
    const preForkGenerationRoot = generationTreeRoot(caughtUp.state);
    const preForkBalance = balanceAt(caughtUp.state, below.chain.syncTime);
    expect(preForkBalance).toBeGreaterThan(0n);

    // And across: the boundary event reaches the still-open pre-fork subscription, and the replay answers.
    yield* Queue.offer(below.wire, [below.replay[0]]);
    yield* Deferred.succeed(below.replayed, below.replay);

    const crossed = yield* restoredStates(
      restored,
      (state) => state.version >= forkVersion && dustCount(state.state) === DUST_EVENT_COUNT,
    );
    expect(yield* runningTag(restored)).toBe(V2Tag);
    // The same dust, not merely the same amount of it — half of it read before the snapshot and half after it.
    expect(dustIdentities(crossed.state)).toEqual(preForkDust);
    expect(commitmentTreeRoot(crossed.state)).toBe(preForkCommitmentRoot);
    expect(generationTreeRoot(crossed.state)).toBe(preForkGenerationRoot);
    expect(balanceAt(crossed.state, below.chain.syncTime)).toBe(preForkBalance);
    expect(crossed.state.progress.appliedIndex).toBe(BigInt(replayEndId));
  });

describe('a dust wallet restored from a snapshot written below the boundary', () => {
  it('finishes its pre-fork timeline and crosses the fork when started with both versions’ keys', async () =>
    Effect.gen(function* () {
      const below = yield* snapshotBelowTheBoundary;

      const restored = below.wallet.walletClass.restore(below.snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      // What it was restored with, before it is started: the dust the snapshot covered, and nothing since.
      const asRestored = yield* restoredStates(restored, () => true);
      expect(dustCount(asRestored.state)).toBe(snapshotStretch);

      yield* Effect.promise(() =>
        restored.startWithKeys({ v8: below.wallet.keys.preFork, v9: below.wallet.keys.postFork }),
      );

      yield* finishesThePreForkStretchAndCrosses(restored, below);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('finishes its pre-fork timeline and crosses the fork when started from the seed', async () =>
    Effect.gen(function* () {
      const below = yield* snapshotBelowTheBoundary;

      const restored = below.wallet.walletClass.restore(below.snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      yield* Effect.promise(() => restored.startWithSeed(dustSeed()));

      yield* finishesThePreForkStretchAndCrosses(restored, below);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('refuses a single post-fork key, naming the instance starts that would have worked', async () =>
    Effect.gen(function* () {
      const below = yield* snapshotBelowTheBoundary;

      const restored = below.wallet.walletClass.restore(below.snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      // Refused rather than accepted and left silently unsynchronized: the key belongs to the ledger version this
      // wallet's API speaks, and the variant the snapshot restored onto is the other one. Read as the error it must be,
      // so this fails both when the call resolves and when it rejects with anything else.
      const failure = Option.getOrThrow(
        Option.filter(
          yield* failureOf(restored.start(below.wallet.keys.postFork)),
          (thrown): thrown is StartMaterial.MissingStartAuxError =>
            thrown instanceof StartMaterial.MissingStartAuxError,
        ),
      );
      expect(failure.variantTag).toBe(V1Tag);
      // And the remedies it names are ones this instance has. The class-level starts of the same names build a *fresh*
      // wallet, so pointing a restored wallet at those would be pointing it at discarding the state it was restored for.
      expect(failure.message).toContain('startWithSeed(seed)');
      expect(failure.message).toContain('startWithKeys({ v8, v9 })');
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('a dust wallet restored from a snapshot written at or past the boundary', () => {
  it('synchronizes from the single post-fork key its own API speaks', async () =>
    Effect.gen(function* () {
      // Unchanged by any of the above, and the reason `start` keeps its shape: on the post-fork variant the key a
      // caller holds is the key the running variant needs, so one is enough.
      const chain = yield* Effect.promise(() => buildDustChain());
      const history = numberedFrom(chain.eventBytes, 1, Number(afterFork));
      const wire = yield* Queue.unbounded<readonly TimelineEvent[]>();
      const replayed = yield* Deferred.make<readonly TimelineEvent[]>();

      const wallet = yield* makeForkWallet({
        preFork: Stream.fromQueue(wire),
        replayed: Deferred.await(replayed),
        networkId,
        forkVersion,
        seed: dustSeed(),
        dustParameters,
        syncTime: chain.syncTime,
        chainVersionProbe: chainReporting(afterFork),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      // Asked and answered: the wallet is on the post-fork variant before a single event exists, so the snapshot it
      // writes declares a post-fork version even though it has read nothing.
      expect(yield* wallet.activeTag).toBe(V2Tag);
      const snapshot = yield* Effect.promise(() => wallet.dust.serializeState());
      expect(Option.getOrThrow(peekProtocolVersion(snapshot))).toBeGreaterThanOrEqual(forkVersion);
      yield* wallet.stop;

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));
      expect(yield* runningTag(restored)).toBe(V2Tag);

      yield* Effect.promise(() => restored.start(wallet.keys.postFork));

      // Started, and demonstrably synchronizing: the timeline arrives after the restore, and the restored wallet is
      // what reads it.
      yield* Deferred.succeed(replayed, history);
      const synced = yield* restoredStates(restored, (state) => dustCount(state.state) === DUST_EVENT_COUNT);
      expect(synced.state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(balanceAt(synced.state, chain.syncTime)).toBeGreaterThan(0n);
      expect(yield* runningTag(restored)).toBe(V2Tag);
    }).pipe(Effect.scoped, Effect.runPromise));
});
