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
 * `waitForSyncedState` is what an application waits on before showing a balance or accepting a payment, so it must not
 * resolve while the liveness check says the indexer's view cannot be trusted.
 *
 * @remarks
 *   The wallet is driven to the point where the indexer's own progress says it is caught up — every transaction applied,
 *   connected — and only a `Behind` verdict stands between it and "synced". A predicate that compared the cursor
 *   against `highestTransactionId` alone would resolve here at once. Which verdicts block completion is decided by
 *   `IndexerLiveness.blocksSyncCompletion` and pinned in its own tests; what is pinned here is that the wallet asks.
 *
 *   Both shipped wallets are covered because each implements `waitForSyncedState` separately: the forking wallet an
 *   application gets from `UnshieldedWallet(configuration)`, and the single-variant one from `CustomUnshieldedWallet`.
 */
import { IndexerLiveness, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { Effect, Queue, Stream } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import { type UnshieldedWalletState } from '../UnshieldedWalletAPI.js';
import { makeForkWallet, makeSingleVariantWallet } from './forkHarness.js';
import { type TimelineItem, timelineTransaction, v2Identity } from './forkTimeline.js';

const forkVersion = ProtocolVersion.ProtocolVersion(7n);

/** A chain past the boundary, so the forking wallet starts on — and stays on — the V2 variant. */
const v9Version = 9;

const owner = v2Identity();

/** One transaction for this address, then the indexer reporting that it has nothing beyond it. */
const caughtUpTimeline: readonly TimelineItem[] = [
  timelineTransaction({ id: 1, protocolVersion: v9Version, owner: owner.addressHex, value: 100n }),
  {
    id: 1,
    protocolVersion: v9Version,
    update: { type: 'UnshieldedTransactionsProgress', highestTransactionId: 1, protocolVersion: v9Version },
  },
];

const chainReporting: ChainVersionProbe = () => Promise.resolve(ProtocolVersion.ProtocolVersion(BigInt(v9Version)));

const behind = IndexerLiveness.Behind({ indexerHeight: 900n, finalizedHeight: 1_000n, lag: 100n });

const inSync = IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n });

/**
 * Every condition but liveness is met — all applied, nothing more on the indexer, connected — and the indexer is
 * behind.
 */
const isCaughtUpButBehind = (state: UnshieldedWalletState): boolean =>
  state.state.progress.isConnected &&
  state.state.progress.appliedId === 1n &&
  state.state.progress.highestTransactionId === 1n &&
  IndexerLiveness.isBehind(state.state.progress.indexerLiveness);

/** Whether `promise` is still pending once everything already queued has run. */
const isStillPending = (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([promise.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 100))]);

/** The pieces of a started wallet these tests need, whichever of the two shipped wallets it is. */
type StartedWallet = {
  readonly state: rx.Observable<UnshieldedWalletState>;
  readonly waitForSyncedState: () => Promise<UnshieldedWalletState>;
};

/**
 * Runs the scenario against one wallet: hold it at `Behind`, with the indexer caught up, and check that
 * `waitForSyncedState` waits; then report `InSync` and check that the same call resolves.
 */
const waitsUntilInSync = (
  wallet: StartedWallet,
  verdicts: Queue.Queue<IndexerLiveness.IndexerLiveness>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Queue.offer(verdicts, behind);

    // Reached before the call is made, so a predicate ignoring liveness would find its answer in the current state and
    // resolve at once — the 100 ms grace below is not what the check depends on.
    yield* Effect.promise(() => rx.firstValueFrom(wallet.state.pipe(rx.filter(isCaughtUpButBehind))));

    const synced = wallet.waitForSyncedState();

    expect(yield* Effect.promise(() => isStillPending(synced))).toBe(true);

    yield* Queue.offer(verdicts, inSync);
    const resolved = yield* Effect.promise(() => synced);

    expect(resolved.state.progress.indexerLiveness).toStrictEqual(inSync);
  });

describe('waitForSyncedState', () => {
  it('should wait on the forking wallet while the indexer is behind, and resolve once it is in sync', async () => {
    await Effect.gen(function* () {
      const verdicts = yield* Queue.unbounded<IndexerLiveness.IndexerLiveness>();
      const wallet = yield* makeForkWallet({
        timeline: caughtUpTimeline,
        forkVersion,
        publicKey: owner,
        chainVersionProbe: chainReporting,
        liveness: Stream.fromQueue(verdicts),
        openEnded: true,
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      yield* waitsUntilInSync(wallet.unshielded, verdicts);
    }).pipe(Effect.scoped, Effect.runPromise);
  });

  it('should wait on the single-variant wallet while the indexer is behind, and resolve once it is in sync', async () => {
    await Effect.gen(function* () {
      const verdicts = yield* Queue.unbounded<IndexerLiveness.IndexerLiveness>();
      const wallet = makeSingleVariantWallet({
        timeline: caughtUpTimeline,
        publicKey: owner,
        liveness: Stream.fromQueue(verdicts),
        openEnded: true,
      });
      yield* Effect.addFinalizer(() => Effect.promise(() => wallet.stop()));
      yield* Effect.promise(() => wallet.start());

      yield* waitsUntilInSync(wallet, verdicts);
    }).pipe(Effect.scoped, Effect.runPromise);
  });
});
