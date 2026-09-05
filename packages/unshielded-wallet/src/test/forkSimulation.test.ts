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
//
// The unshielded hard-fork crossing, end to end.
//
// The load-bearing claim is narrower and sharper than the shielded and dust proofs make, because unshielded's design
// is: THE BOUNDARY TRANSACTION IS APPLIED EXACTLY ONCE, BY THE NEW VARIANT. The old variant sees it, records its
// version and refuses to apply any part of it; the cursor consequently does not move; the migration parks that cursor;
// and the new variant, subscribing from it, is served that same transaction and applies it. Every step of that chain is
// asserted separately, because each one alone is satisfiable by a wrong implementation.
//
// The second claim is the structural carry: unlike shielded and dust, which start the new variant empty and wait for
// the indexer's replay to hand their coins back, unshielded carries every UTXO across. So the wallet never passes
// through a state in which it has forgotten what it owns.
//
// Tier: unit. There is no WASM translation anywhere in this path and none is warranted — unshielded state is public
// data and the wire format is JSON, so there is no ledger encoding for a translation to be faithful to. The two
// variants are nonetheless the genuine ledger-v8 and ledger-v9 trees, each with its own ledger module, and the
// identities are derived through each version's real keystore.
import { NetworkId, ProtocolVersion, type UnprovenTx } from '@midnightntwrk/wallet-sdk-abstractions';
import { UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { ArrayOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, identity, Option, pipe, type Scope, Stream } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import { type UnshieldedWalletState } from '../UnshieldedWalletAPI.js';
import { V1Tag } from '../v1/index.js';
import { V2Tag } from '../v2/index.js';
import {
  forkSeed,
  postForkIdentity,
  preForkIdentity,
  timelineTokenType,
  timelineTransaction,
  type TimelineItem,
} from './forkTimeline.js';
import {
  bookedUtxosOf,
  type CarriedUtxo,
  type ForkedState,
  type ForkWallet,
  makeForkWallet,
  utxosOf,
} from './forkHarness.js';

const networkId = NetworkId.NetworkId.Undeployed;
/** The pre-fork variant owns everything below this; the post-fork variant takes over at it. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
const preForkVersion = 1;

const preFork = preForkIdentity(networkId);
const postFork = postForkIdentity(networkId);

/**
 * Three pre-fork transactions, the boundary transaction, and two beyond it.
 *
 * @remarks
 *   Ids run continuously across the boundary, which is the confirmed indexer semantics: the post-fork timeline continues
 *   the numbering rather than restarting it.
 */
const timeline = [
  timelineTransaction({ id: 1, protocolVersion: preForkVersion, owner: preFork.addressHex, value: 100n }),
  timelineTransaction({ id: 2, protocolVersion: preForkVersion, owner: preFork.addressHex, value: 200n }),
  timelineTransaction({ id: 3, protocolVersion: preForkVersion, owner: preFork.addressHex, value: 300n }),
  // The boundary transaction: reported at the fork version, so the pre-fork variant must not apply it.
  timelineTransaction({ id: 4, protocolVersion: Number(forkVersion), owner: preFork.addressHex, value: 444n }),
  timelineTransaction({ id: 5, protocolVersion: Number(forkVersion), owner: preFork.addressHex, value: 500n }),
  timelineTransaction({ id: 6, protocolVersion: Number(forkVersion), owner: preFork.addressHex, value: 600n }),
];

const valuesOf = (utxos: readonly CarriedUtxo[]): readonly bigint[] => utxos.map((u) => u.value);

describe('unshielded hard-fork crossing', () => {
  it('carries every UTXO across and applies the boundary transaction exactly once, in the new variant', async () => {
    const wallet = await Effect.runPromise(makeForkWallet({ timeline, forkVersion, publicKey: postFork }));

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Subscribed BEFORE starting: `stateChanges` does not replay, so a settled state reached while nobody was
        // listening would be missed and the wait would hang rather than fail.
        const settled = yield* Effect.fork(wallet.awaitState((state) => state.state.progress.appliedId === 6n));
        yield* wallet.start;
        const migration = yield* wallet.awaitMigration;
        const final = yield* settled.await.pipe(Effect.flatMap(identity));
        const tag = yield* wallet.activeTag;
        yield* wallet.stop;
        return { migration, final: final.state, tag };
      }),
    );

    // --- the old variant stopped exactly at the boundary ---
    // It applied 1..3 and refused the whole of 4, so its cursor sits at 3 and it holds three UTXOs.
    expect(result.migration.from.appliedId).toBe(3n);
    expect(valuesOf(result.migration.from.utxos)).toEqual([100n, 200n, 300n]);
    // It DID record the boundary version — that is what triggered the hand-over.
    expect(result.migration.from.protocolVersion).toBe(7n);
    // And it did NOT take the boundary transaction's UTXO.
    expect(valuesOf(result.migration.from.utxos)).not.toContain(444n);

    // --- the migration is a structural carry, not a fresh state ---
    // This is the assertion that distinguishes unshielded from shielded and dust: everything crosses.
    expect(result.migration.to.utxos).toEqual(result.migration.from.utxos);
    // Identity and network cross too, with the key widened to the tagged form.
    expect(result.migration.to.address).toBe(preFork.address);
    expect(result.migration.to.networkId).toBe(networkId);
    expect(result.migration.to.protocolVersion).toBe(7n);
    // The cursor is PARKED. Asserted on the state the migration produced, before any sync has touched it, which is the
    // only place parking is distinguishable from rewinding: a cursor reset to 0 would re-read 1..3 and still end up
    // looking correct, and a cursor advanced past the boundary would silently lose transaction 4.
    expect(result.migration.to.appliedId).toBe(result.migration.from.appliedId);
    expect(result.migration.to.appliedId).toBe(3n);

    // --- the new variant is running and consumed the rest of the timeline ---
    expect(result.tag).toBe(V2Tag);
    expect(result.final.progress.appliedId).toBe(6n);

    // --- the boundary transaction was applied EXACTLY once ---
    const finalUtxos = utxosOf(result.final);
    expect(valuesOf(finalUtxos).filter((v) => v === 444n)).toEqual([444n]);
    // ...and the wallet holds the pre-fork three plus the three from the boundary onwards. Six, not nine: nothing was
    // applied twice, and nothing was dropped.
    expect(valuesOf(finalUtxos)).toEqual([100n, 200n, 300n, 444n, 500n, 600n]);
  });

  it('carries the pre-fork UTXOs field for field, not merely by count', async () => {
    const wallet = await Effect.runPromise(makeForkWallet({ timeline, forkVersion, publicKey: postFork }));

    const { before, after } = await Effect.runPromise(
      Effect.gen(function* () {
        const settled = yield* Effect.fork(wallet.awaitState((state) => state.state.progress.appliedId === 6n));
        yield* wallet.start;
        const migration = yield* wallet.awaitMigration;
        const final = yield* settled.await.pipe(Effect.flatMap(identity));
        yield* wallet.stop;
        return { before: migration.from.utxos, after: utxosOf(final.state) };
      }),
    );

    // UTXO for UTXO: value, owner, token type, intent hash, output number and creation time all survive the crossing.
    const carried = after.filter((u) => before.some((b) => b.value === u.value));
    expect(carried).toEqual(before);
  });

  it('derives the same address from the same secret on both sides of the boundary', () => {
    // The lemma the structural carry rests on: the two ledger versions disagree about the SHAPE of a verifying key,
    // but not about the address it derives to. If they ever diverge here, carrying the address across is a fiction and
    // this test retires the model loudly.
    expect(postFork.addressHex).toBe(preFork.addressHex);
    expect(postFork.address).toBe(preFork.address);
    // The keys themselves are shaped differently, which is exactly what the migration widens.
    expect(typeof preFork.publicKey).toBe('string');
    expect(postFork.publicKey).toEqual({ tag: 'schnorr', value: preFork.publicKey });
    expect(forkSeed()).toHaveLength(32);
  });

  it('does not migrate on a version bump that stays inside the running variant range', async () => {
    const withinRange = [
      timelineTransaction({ id: 1, protocolVersion: 1, owner: preFork.addressHex, value: 100n }),
      // 5 is still below the boundary of 7, so this must be applied, not deferred.
      timelineTransaction({ id: 2, protocolVersion: 5, owner: preFork.addressHex, value: 200n }),
    ];
    const wallet = await Effect.runPromise(makeForkWallet({ timeline: withinRange, forkVersion, publicKey: postFork }));

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const settledFiber = yield* Effect.fork(wallet.awaitState((state) => state.state.progress.appliedId === 2n));
        yield* wallet.start;
        const settled = yield* settledFiber.await.pipe(Effect.flatMap(identity));
        const tag = yield* wallet.activeTag;
        const migration = yield* wallet.migration;
        yield* wallet.stop;
        return { settled: settled.state, tag, migration };
      }),
    );

    expect(result.tag).toBe(V1Tag);
    expect(Option.isNone(result.migration)).toBe(true);
    // Applied, not deferred: the cursor moved and the UTXO is held.
    expect(result.settled.progress.appliedId).toBe(2n);
    expect(valuesOf(utxosOf(result.settled))).toEqual([100n, 200n]);
    expect(result.settled.protocolVersion).toBe(5n);
  });

  it('reaches the same end state from a wallet whose first sync already contains the fork', async () => {
    // Scenario 2: a fresh wallet syncing a timeline that already straddles the boundary. It still syncs the pre-fork
    // prefix with the old variant, hands over, and consumes the rest — double work by design, correct by construction.
    const wallet = await Effect.runPromise(makeForkWallet({ timeline, forkVersion, publicKey: postFork }));

    const final = await Effect.runPromise(
      Effect.gen(function* () {
        const settledFiber = yield* Effect.fork(wallet.awaitState((state) => state.state.progress.appliedId === 6n));
        yield* wallet.start;
        yield* wallet.awaitMigration;
        const settled = yield* settledFiber.await.pipe(Effect.flatMap(identity));
        yield* wallet.stop;
        return settled.state;
      }),
    );

    expect(valuesOf(utxosOf(final))).toEqual([100n, 200n, 300n, 444n, 500n, 600n]);
    expect(final.progress.appliedId).toBe(6n);
  });
});

// =============================================================================
// A transfer the wallet was still holding UTXOs for when the boundary arrived
// =============================================================================

/**
 * The pre-fork prefix of the timeline, with nothing at or past the boundary.
 *
 * @remarks
 *   A wallet reading only this settles on the pre-fork variant and stays there, which is what makes "build a transfer
 *   while the old ledger version is still the current one" a fact rather than a race against the hand-over.
 */
const beforeTheFork = timeline.filter((item) => item.protocolVersion < Number(forkVersion));

/** Somebody else's address, so a transfer really takes value out of the wallet. */
const stranger = new UnshieldedAddress(Buffer.alloc(32, 7));

/** Far enough ahead that nothing here expires. */
const ttl = new Date(2_000_000_000_000);

/**
 * More than any two of the wallet's three pre-fork UTXOs cover, so all three are booked whatever order coin selection
 * considers them in — and less than all three, so the transfer also produces change.
 */
const transferAmount = 550n;

/** What the transfer hands back to the wallet: 600 held, 550 sent. */
const changeAmount = 50n;

/** The wallet's current state, as its public API projects it. */
const publicState = (wallet: ForkWallet['unshielded']): Effect.Effect<UnshieldedWalletState<string>> =>
  Effect.promise(() => rx.firstValueFrom(wallet.state));

/**
 * The harness's own settle-wait, for a wallet the harness did not start.
 *
 * @remarks
 *   A wallet restored from a snapshot comes from the wallet _class_, not from `makeForkWallet`, so it arrives without the
 *   harness's observation channels. This is the one of them these proofs need. Same caveat as the harness's: fork it
 *   before starting, and use monotone predicates only.
 */
const awaitStateOf = (
  wallet: ForkWallet['unshielded'],
  predicate: (state: ForkedState) => boolean,
): Effect.Effect<ForkedState, WalletRuntimeError> =>
  pipe(
    wallet.runtime.stateChanges,
    Stream.filter(predicate),
    Stream.take(1),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

/** The value of every coin in a projection, however the wallet is holding it. */
const totalOf = (coins: readonly { readonly utxo: { readonly value: bigint } }[]): bigint =>
  ArrayOps.sumBigInt(coins.map((coin) => coin.utxo.value));

/**
 * A pre-fork wallet that has built a transfer and never gets to submit it.
 *
 * @remarks
 *   The wallet is the shipped one and the transfer is built through its public API, so the booking is the real one: the
 *   inputs coin selection picked have moved out of the available set and into the pending one, exactly as they would
 *   while the application waited for the transaction to be included.
 *
 *   It is handed on as a **snapshot** rather than as a running wallet because the hand-over is what has to be observed
 *   next, and a wallet whose timeline already contains the boundary would cross it the moment it caught up — long
 *   before a test could build anything. Saving a wallet with a transaction in flight and reopening it is also the
 *   ordinary way an application meets this: the transfer is built, the process restarts, and the chain has forked by
 *   the time the wallet syncs again.
 */
const walletWithATransferInFlight: Effect.Effect<
  { readonly handle: UnprovenTx; readonly snapshot: string; readonly state: UnshieldedWalletState<string> },
  never,
  Scope.Scope
> = Effect.gen(function* () {
  const wallet = yield* makeForkWallet({ timeline: beforeTheFork, forkVersion, publicKey: postFork });
  yield* Effect.addFinalizer(() => wallet.stop);

  const settled = yield* Effect.fork(wallet.awaitState((state) => state.state.progress.appliedId === 3n));
  yield* wallet.start;
  yield* settled.await.pipe(Effect.flatMap(identity), Effect.orDie);

  const handle = yield* Effect.promise(() =>
    wallet.unshielded.transferTransaction(
      [{ amount: transferAmount, type: timelineTokenType, receiverAddress: stranger }],
      ttl,
    ),
  );

  const state = yield* publicState(wallet.unshielded);
  return { handle, snapshot: state.serialize(), state };
});

/** A wallet reopened from `snapshot` onto a timeline that forks, run until it has consumed all of it. */
const crossTheFork = (params: {
  readonly snapshot: string;
  readonly timeline: readonly TimelineItem[];
  readonly settleAt: bigint;
}): Effect.Effect<{ readonly crossed: ForkWallet['unshielded']; readonly host: ForkWallet }, never, Scope.Scope> =>
  Effect.gen(function* () {
    // Restoring is a class-level entry point, so the class has to come from somewhere: this host wallet is built only
    // to supply it — and its capturing migration, which is what lets the crossing be awaited rather than guessed at.
    const host = yield* makeForkWallet({ timeline: params.timeline, forkVersion, publicKey: postFork });
    yield* Effect.addFinalizer(() => host.stop);

    const crossed = host.walletClass.restore(params.snapshot);
    yield* Effect.addFinalizer(() => Effect.promise(() => crossed.stop()));

    const settled = yield* Effect.fork(
      awaitStateOf(crossed, (state) => state.state.progress.appliedId === params.settleAt),
    );
    yield* Effect.promise(() => crossed.start());
    yield* host.awaitMigration;
    yield* settled.await.pipe(Effect.flatMap(identity), Effect.orDie);

    return { crossed, host };
  });

describe('an unshielded wallet crossing the boundary with a transfer still in flight', () => {
  it('releases the UTXOs that transfer had booked back into the available set', async () =>
    Effect.gen(function* () {
      const inFlight = yield* walletWithATransferInFlight;

      // The premise, asserted rather than assumed: building the transfer really did book all three UTXOs, leaving the
      // wallet with nothing available to spend.
      expect(valuesOf(bookedUtxosOf(inFlight.state.state))).toEqual([100n, 200n, 300n]);
      expect(valuesOf(utxosOf(inFlight.state.state))).toEqual([]);

      const { crossed } = yield* crossTheFork({ snapshot: inFlight.snapshot, timeline, settleAt: 6n });
      const state = yield* publicState(crossed);

      // That transfer was built for the pre-fork ledger version and can never be included past the boundary, so the
      // UTXOs it reserved are the wallet's to spend again — and nobody had to call anything for that to happen.
      expect(valuesOf(bookedUtxosOf(state.state))).toEqual([]);
      expect(valuesOf(utxosOf(state.state))).toEqual([100n, 200n, 300n, 444n, 500n, 600n]);
      // Nothing is merely hidden: every coin the wallet holds after the crossing, it can spend.
      expect(state.balances[timelineTokenType]).toBe(totalOf(state.totalCoins));
    }).pipe(Effect.scoped, Effect.runPromise));

  it('has nothing left to do when the pre-fork transaction is reverted after the crossing', async () =>
    Effect.gen(function* () {
      const inFlight = yield* walletWithATransferInFlight;
      const { crossed } = yield* crossTheFork({ snapshot: inFlight.snapshot, timeline, settleAt: 6n });

      const before = yield* publicState(crossed);
      const reverted = yield* Effect.promise(() => crossed.revertTransaction(inFlight.handle));
      const after = yield* publicState(crossed);

      // The claim `revertTransaction` makes about a handle from the other side of the boundary — that there is nothing
      // of this variant's booked against it — is true because the crossing already released it. So the call is a
      // genuine no-op rather than a silently skipped release.
      expect(reverted).toBeUndefined();
      expect(valuesOf(utxosOf(after.state))).toEqual(valuesOf(utxosOf(before.state)));
      expect(valuesOf(bookedUtxosOf(after.state))).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('writes a snapshot that reopens with nothing booked', async () =>
    Effect.gen(function* () {
      const inFlight = yield* walletWithATransferInFlight;
      const { crossed, host } = yield* crossTheFork({ snapshot: inFlight.snapshot, timeline, settleAt: 6n });

      const snapshot = yield* Effect.promise(() => crossed.serializeState());
      const reopened = host.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => reopened.stop()));

      // The stuck state must not outlive the process that produced it: what a released wallet persists is a released
      // wallet, so an application that saves and restores does not re-acquire the booking.
      const state = yield* publicState(reopened);
      expect(valuesOf(bookedUtxosOf(state.state))).toEqual([]);
      expect(valuesOf(utxosOf(state.state))).toEqual([100n, 200n, 300n, 444n, 500n, 600n]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('does not resurrect a booked UTXO whose transaction confirmed before the boundary', async () =>
    Effect.gen(function* () {
      const inFlight = yield* walletWithATransferInFlight;

      // The other order of events, and the one the release has to be safe against: the transfer lands in a pre-fork
      // block after all. The indexer reports it as the UTXOs it consumed alongside the change it produced.
      const confirmedBeforeTheFork: readonly TimelineItem[] = [
        ...beforeTheFork,
        timelineTransaction({
          id: 4,
          protocolVersion: preForkVersion,
          owner: preFork.addressHex,
          value: changeAmount,
          spentUtxos: inFlight.state.pendingCoins,
        }),
        timelineTransaction({ id: 5, protocolVersion: Number(forkVersion), owner: preFork.addressHex, value: 444n }),
      ];

      const { crossed } = yield* crossTheFork({
        snapshot: inFlight.snapshot,
        timeline: confirmedBeforeTheFork,
        settleAt: 5n,
      });
      const state = yield* publicState(crossed);

      // Spent is spent. The pre-fork variant applies the confirmation before it ever sees the boundary — the cursor
      // gates the hand-over — and applying it removes those UTXOs from BOTH maps, so the crossing has nothing left to
      // release and cannot hand back a coin the chain has already consumed.
      expect(valuesOf(bookedUtxosOf(state.state))).toEqual([]);
      expect(valuesOf(utxosOf(state.state))).toEqual([changeAmount, 444n]);
    }).pipe(Effect.scoped, Effect.runPromise));
});
