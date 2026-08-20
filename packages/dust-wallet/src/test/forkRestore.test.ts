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
 * Restoring a snapshot into the variant that wrote it, through the wallet class an application holds.
 *
 * @remarks
 *   `tryRestore.test.ts` pins what a snapshot the wallet cannot read does, and the runtime pins `startAtVariant` over
 *   synthetic variants. Neither says that the pieces meet correctly in a shipped forking wallet, which is the
 *   composition an application actually calls: peek at the snapshot, resolve the variant that owns the version it
 *   declares, deserialize with _that_ variant's deserializer, and start there.
 *
 *   Both epochs are pinned in one file on purpose. A router that always answered with the head variant would pass the
 *   pre-fork half and fail the post-fork one; a router that always answered with the last registration would do the
 *   reverse. Only routing on the snapshot's own declared version passes both.
 *
 *   The snapshots are the suite's own: each is written by a running wallet through `serializeState()`, so what is
 *   restored is what this package actually produces rather than a fixture that could drift from it.
 */

import { LedgerParameters as PreForkLedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { Deferred, Effect, Option, Queue, type Scope, Stream, pipe } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { peekProtocolVersion } from '../Restore.js';
import { V1Tag } from '../v1/RunningV1Variant.js';
import { DUST_EVENT_COUNT, type DustChain, buildDustChain, dustSeed } from '../v1/test/dustEvents.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import { dustParameters as postForkDustParameters } from '../v2/test/dustEvents.js';
import { type ForkWallet, makeForkWallet } from './forkHarness.js';
import { type TimelineEvent, numberedFrom } from './forkReplay.js';
import { balanceAt, dustCount } from './forkWalletAssertions.js';

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

/** A wallet pointed at a timeline every event of which is reported at `version`. */
const walletOnChainAt = (
  chain: DustChain,
  version: ProtocolVersion.ProtocolVersion,
  chainVersionProbe: ChainVersionProbe,
): Effect.Effect<ForkWallet, never, Scope.Scope> =>
  Effect.gen(function* () {
    const history: readonly TimelineEvent[] = numberedFrom(chain.eventBytes, 1, Number(version));
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
      chainVersionProbe,
    });
    yield* Effect.addFinalizer(() => wallet.stop);
    yield* wallet.start;

    yield* Queue.offer(wire, history);
    yield* Deferred.succeed(replayed, history);

    return wallet;
  });

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

/** The first state a restored wallet publishes, which is the one it was restored onto. */
const restoredState = (wallet: ForkWallet['dust']) => Effect.promise(() => rx.firstValueFrom(wallet.state));

describe('a dust wallet restoring a snapshot through the class it was started from', () => {
  it('restores a snapshot written below the boundary onto the pre-fork variant, with what it held', async () =>
    Effect.gen(function* () {
      const chain = yield* Effect.promise(() => buildDustChain());
      const wallet = yield* walletOnChainAt(chain, beforeFork, chainReporting(beforeFork));

      const synced = yield* wallet.awaitState((state) => dustCount(state.state) === DUST_EVENT_COUNT);
      expect(yield* wallet.activeTag).toBe(V1Tag);

      const snapshot = yield* Effect.promise(() => wallet.dust.serializeState());
      // The snapshot names the epoch that wrote it, which is the only thing the restore has to go on.
      expect(Option.getOrThrow(peekProtocolVersion(snapshot))).toBe(synced.state.protocolVersion);
      expect(synced.state.protocolVersion).toBeLessThan(forkVersion);

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      expect(yield* runningTag(restored)).toBe(V1Tag);

      const state = yield* restoredState(restored);
      expect(state.protocolVersion).toBeLessThan(forkVersion);
      expect(dustCount(state.state)).toBe(DUST_EVENT_COUNT);
      expect(balanceAt(state.state, chain.syncTime)).toBe(balanceAt(synced.state, chain.syncTime));
      expect(state.state.publicKey.publicKey).toBe(synced.state.publicKey.publicKey);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('restores a snapshot written at or past the boundary onto the post-fork variant, with what it held', async () =>
    Effect.gen(function* () {
      const chain = yield* Effect.promise(() => buildDustChain());
      const wallet = yield* walletOnChainAt(chain, afterFork, chainReporting(afterFork));

      const synced = yield* wallet.awaitState((state) => dustCount(state.state) === DUST_EVENT_COUNT);
      expect(yield* wallet.activeTag).toBe(V2Tag);

      const snapshot = yield* Effect.promise(() => wallet.dust.serializeState());
      expect(Option.getOrThrow(peekProtocolVersion(snapshot))).toBe(synced.state.protocolVersion);
      expect(synced.state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      expect(yield* runningTag(restored)).toBe(V2Tag);

      const state = yield* restoredState(restored);
      expect(state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(dustCount(state.state)).toBe(DUST_EVENT_COUNT);
      expect(balanceAt(state.state, chain.syncTime)).toBe(balanceAt(synced.state, chain.syncTime));
      expect(state.state.publicKey.publicKey).toBe(synced.state.publicKey.publicKey);
    }).pipe(Effect.scoped, Effect.runPromise));
});
