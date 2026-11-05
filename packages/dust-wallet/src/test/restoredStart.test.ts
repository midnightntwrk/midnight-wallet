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
 *   again, and which key it needs is decided by the variant the snapshot put it on.
 *
 *   The caller cannot be asked to know which variant that is, so a wallet spanning the boundary is started with one
 *   ledger version's `DustSecretKey` per side of it, wherever its snapshot was written. A snapshot written below the
 *   boundary restores onto the V1 variant, which takes the ledger-v8 key from them: the wallet finishes the ledger-v8
 *   stretch of the timeline it had not read, crosses the fork, and re-discovers its dust from the replay. One written
 *   at or past the boundary restores onto the V2 variant, which takes the ledger-v9 key from the same start.
 *
 *   The negative is kept beside them, at compile time: one side of the boundary alone is not something this wallet can be
 *   started with, so a start that would leave a restored wallet unable to synchronize cannot be written.
 */

import { LedgerParameters as V8LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { type DustSecretKey as V9SecretKey } from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { type CanAssign, type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { Deferred, Effect, Option, Queue, type Scope, Stream, pipe } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { peekProtocolVersion } from '../Restore.js';
import { V1Tag } from '../v1/RunningV1Variant.js';
import { DUST_EVENT_COUNT, type DustChain, buildDustChain, dustSeed } from '../v1/test/dustEvents.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import { dustParameters as v9DustParameters } from '../v2/test/dustEvents.js';
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

/** Where the wallet registers its V2 variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has already forked — past the boundary rather than exactly at it. */
const v9Version = ProtocolVersion.ProtocolVersion(9n);
/** A chain that has not — a version the V1 variant owns. */
const v8Version = ProtocolVersion.ProtocolVersion(5n);

const dustParameters = {
  v8: V8LedgerParameters.initialParameters().dust,
  v9: v9DustParameters(),
};

/**
 * How much of the ledger-v8 timeline the snapshot was written over.
 *
 * @remarks
 *   Deliberately short of the whole of it: what the restored wallet is asked to do below is finish reading a stretch of
 *   timeline the snapshot never saw, which is the ordinary reason an application restores at all.
 */
const snapshotStretch = 2;

/**
 * The event id the replay opens at.
 *
 * One past the ledger-v8 history, because there is only one id space: the indexer numbers its replay onwards from the
 * id it had reached when the fork happened.
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

/** A wallet that read the opening stretch of a ledger-v8 timeline, and the snapshot it wrote there. */
type SnapshotBelow = Readonly<{
  chain: DustChain;
  wallet: ForkWallet;
  snapshot: string;
  /** The ledger-v8 wire, still open: what the restored wallet reads the rest of the timeline from. */
  wire: Queue.Queue<readonly TimelineEvent[]>;
  /** The replay, still unfulfilled: what the V2 variant reads once the fork has happened. */
  replayed: Deferred.Deferred<readonly TimelineEvent[]>;
  /** The whole ledger-v8 history, of which the snapshot covers only {@link snapshotStretch} events. */
  history: readonly TimelineEvent[];
  /** The same events again, renumbered from the boundary and reported at the ledger-v9 version. */
  replay: readonly TimelineEvent[];
}>;

const snapshotBelowTheBoundary: Effect.Effect<SnapshotBelow, unknown, Scope.Scope> = Effect.gen(function* () {
  const chain = yield* Effect.promise(() => buildDustChain());
  const history = numberedFrom(chain.eventBytes, 1, Number(v8Version));
  const replay = numberedFrom(chain.eventBytes, boundaryId, Number(forkVersion));
  const wire = yield* Queue.unbounded<readonly TimelineEvent[]>();
  const replayed = yield* Deferred.make<readonly TimelineEvent[]>();

  const wallet = yield* makeForkWallet({
    v8: Stream.fromQueue(wire),
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
 *   Both halves matter and neither implies the other. First it finishes the ledger-v8 stretch — proving it was started at
 *   all, on the variant that takes the ledger-v8 side of its keys. Then it crosses and re-discovers, from the replay,
 *   exactly the dust it was holding on the other side.
 */
const finishesTheV8StretchAndCrosses = (restored: ForkWallet['dust'], below: SnapshotBelow) =>
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
    const v8Dust = dustIdentities(caughtUp.state);
    const v8CommitmentRoot = commitmentTreeRoot(caughtUp.state);
    const v8GenerationRoot = generationTreeRoot(caughtUp.state);
    const v8Balance = balanceAt(caughtUp.state, below.chain.syncTime);
    expect(v8Balance).toBeGreaterThan(0n);

    // And across: the boundary event reaches the still-open ledger-v8 subscription, and the replay answers.
    yield* Queue.offer(below.wire, [below.replay[0]]);
    yield* Deferred.succeed(below.replayed, below.replay);

    const crossed = yield* restoredStates(
      restored,
      (state) => state.version >= forkVersion && dustCount(state.state) === DUST_EVENT_COUNT,
    );
    expect(yield* runningTag(restored)).toBe(V2Tag);
    // The same dust, not merely the same amount of it — half of it read before the snapshot and half after it.
    expect(dustIdentities(crossed.state)).toEqual(v8Dust);
    expect(commitmentTreeRoot(crossed.state)).toBe(v8CommitmentRoot);
    expect(generationTreeRoot(crossed.state)).toBe(v8GenerationRoot);
    expect(balanceAt(crossed.state, below.chain.syncTime)).toBe(v8Balance);
    expect(crossed.state.progress.appliedIndex).toBe(BigInt(replayEndId));
  });

describe('a dust wallet restored from a snapshot written below the boundary', () => {
  it('finishes its ledger-v8 timeline and crosses the fork when started with both versions’ keys', async () =>
    Effect.gen(function* () {
      const below = yield* snapshotBelowTheBoundary;

      const restored = below.wallet.walletClass.restore(below.snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      // What it was restored with, before it is started: the dust the snapshot covered, and nothing since.
      const asRestored = yield* restoredStates(restored, () => true);
      expect(dustCount(asRestored.state)).toBe(snapshotStretch);

      yield* Effect.promise(() => restored.start(below.wallet.keys));

      yield* finishesTheV8StretchAndCrosses(restored, below);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('cannot be started with a single ledger-v9 key, which the V1 variant it restored onto could not use', () => {
    // Refused by the compiler rather than at run time: one side of the boundary is not something a wallet spanning it
    // takes, so there is no start a wallet restored below the boundary could accept and then not synchronize from.
    type Keys = Parameters<ForkWallet['dust']['start']>[0];
    type _1 = Expect<Equal<CanAssign<V9SecretKey, Keys>, false>>;
    type _2 = Expect<Equal<CanAssign<Readonly<{ v9: V9SecretKey }>, Keys>, false>>;
  });
});

describe('a dust wallet restored from a snapshot written at or past the boundary', () => {
  it('synchronizes when started with both versions’ keys, taking the ledger-v9 side', async () =>
    Effect.gen(function* () {
      // The same start as below the boundary, because the caller does not know which side a snapshot was written on.
      const chain = yield* Effect.promise(() => buildDustChain());
      const history = numberedFrom(chain.eventBytes, 1, Number(v9Version));
      const wire = yield* Queue.unbounded<readonly TimelineEvent[]>();
      const replayed = yield* Deferred.make<readonly TimelineEvent[]>();

      const wallet = yield* makeForkWallet({
        v8: Stream.fromQueue(wire),
        replayed: Deferred.await(replayed),
        networkId,
        forkVersion,
        seed: dustSeed(),
        dustParameters,
        syncTime: chain.syncTime,
        chainVersionProbe: chainReporting(v9Version),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      // Asked and answered: the wallet is on the V2 variant before a single event exists, so the snapshot it
      // writes declares a ledger-v9 version even though it has read nothing.
      expect(yield* wallet.activeTag).toBe(V2Tag);
      const snapshot = yield* Effect.promise(() => wallet.dust.serializeState());
      expect(Option.getOrThrow(peekProtocolVersion(snapshot))).toBeGreaterThanOrEqual(forkVersion);
      yield* wallet.stop;

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));
      expect(yield* runningTag(restored)).toBe(V2Tag);

      yield* Effect.promise(() => restored.start(wallet.keys));

      // Started, and demonstrably synchronizing: the timeline arrives after the restore, and the restored wallet is
      // what reads it.
      yield* Deferred.succeed(replayed, history);
      const synced = yield* restoredStates(restored, (state) => dustCount(state.state) === DUST_EVENT_COUNT);
      expect(synced.state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(balanceAt(synced.state, chain.syncTime)).toBeGreaterThan(0n);
      expect(yield* runningTag(restored)).toBe(V2Tag);
    }).pipe(Effect.scoped, Effect.runPromise));
});
