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
 *   connected — and only the liveness verdict stands between it and "synced". That isolates the one condition under
 *   test: a predicate that compared the cursor against `highestTransactionId` alone would resolve here at once.
 *
 *   Both shipped wallets are covered because each implements `waitForSyncedState` separately: the forking wallet an
 *   application gets from `UnshieldedWallet(configuration)`, and the single-variant one from `CustomUnshieldedWallet`.
 */
import { IndexerLiveness, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { Effect, Option, Queue, Stream } from 'effect';
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

const wrongNetwork = IndexerLiveness.WrongNetwork({
  height: 0n,
  indexerBlockHash: Option.some('aa'.repeat(32)),
  nodeBlockHash: Option.some('bb'.repeat(32)),
});

const inSync = IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n });

/**
 * The verdicts that must hold `waitForSyncedState` back. `Unknown` is reached by sending nothing: it is the state of a
 * wallet whose first poll has not landed, and the indexer's first progress update lands well before it.
 */
const gatingVerdicts: readonly (readonly [string, Option.Option<IndexerLiveness.IndexerLiveness>])[] = [
  ['Behind', Option.some(behind)],
  ['WrongNetwork', Option.some(wrongNetwork)],
  ['Unknown, before the first verdict', Option.none()],
];

/** Every condition but liveness is met: all applied, nothing more on the indexer, connected. */
const isCaughtUpOnTheIndexer = (state: UnshieldedWalletState): boolean =>
  state.state.progress.isConnected &&
  state.state.progress.appliedId === 1n &&
  state.state.progress.highestTransactionId === 1n;

/** How the verdict a test sent is observed on the wallet, `Unknown` included. */
const holdsVerdict =
  (expected: Option.Option<IndexerLiveness.IndexerLiveness>) =>
  (state: UnshieldedWalletState): boolean =>
    state.state.progress.indexerLiveness._tag ===
    Option.match(expected, { onNone: () => 'Unknown', onSome: (verdict) => verdict._tag });

/** Whether `promise` is still pending once everything already queued has run. */
const isStillPending = (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([promise.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 100))]);

/** The pieces of a started wallet these tests need, whichever of the two shipped wallets it is. */
type StartedWallet = {
  readonly state: rx.Observable<UnshieldedWalletState>;
  readonly waitForSyncedState: (allowedGap?: bigint) => Promise<UnshieldedWalletState>;
};

/**
 * Runs the scenario against one wallet: hold it at a gating verdict, with the indexer caught up, and check that
 * `waitForSyncedState` waits; then report `InSync` and check that the same call resolves.
 */
const waitsUntilInSync = (
  wallet: StartedWallet,
  verdicts: Queue.Queue<IndexerLiveness.IndexerLiveness>,
  gating: Option.Option<IndexerLiveness.IndexerLiveness>,
  allowedGap?: bigint,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Option.match(gating, { onNone: () => Effect.void, onSome: (verdict) => Queue.offer(verdicts, verdict) });

    // Reached before the call is made, so a predicate ignoring liveness would find its answer in the current state and
    // resolve at once — the 100 ms grace below is not what the check depends on.
    yield* Effect.promise(() =>
      rx.firstValueFrom(wallet.state.pipe(rx.filter((s) => isCaughtUpOnTheIndexer(s) && holdsVerdict(gating)(s)))),
    );

    const synced = wallet.waitForSyncedState(allowedGap);

    expect(yield* Effect.promise(() => isStillPending(synced))).toBe(true);

    yield* Queue.offer(verdicts, inSync);
    const resolved = yield* Effect.promise(() => synced);

    expect(resolved.state.progress.indexerLiveness).toStrictEqual(inSync);
  });

describe('waitForSyncedState on the forking unshielded wallet', () => {
  describe.each(gatingVerdicts)('while the liveness verdict is %s', (_label, gating) => {
    it('should wait, and resolve once the indexer is reported in sync', async () => {
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

        yield* waitsUntilInSync(wallet.unshielded, verdicts, gating);
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });

  it('should hold back a caller that allows a gap, because the gap is in transactions and not in blocks', async () => {
    // `allowedGap` relaxes how far the cursor may trail the indexer. It must not relax the liveness check too: an
    // indexer behind the chain is stale however close the wallet is to it.
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

      yield* waitsUntilInSync(wallet.unshielded, verdicts, Option.some(behind), 50n);
    }).pipe(Effect.scoped, Effect.runPromise);
  });
});

describe('waitForSyncedState on the single-variant unshielded wallet', () => {
  describe.each(gatingVerdicts)('while the liveness verdict is %s', (_label, gating) => {
    it('should wait, and resolve once the indexer is reported in sync', async () => {
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

        yield* waitsUntilInSync(wallet, verdicts, gating);
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });
});
