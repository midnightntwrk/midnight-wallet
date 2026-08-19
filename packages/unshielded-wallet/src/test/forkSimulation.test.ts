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
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, identity, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet as PreForkWallet } from '../v1/CoreWallet.js';
import { UnshieldedState as PreForkState } from '../v1/UnshieldedState.js';
import { V1Tag } from '../v1/index.js';
import { V2Tag } from '../v2/index.js';
import { forkSeed, postForkIdentity, preForkIdentity, timelineTransaction } from './forkTimeline.js';
import { makeForkWallet, utxosOf, type CarriedUtxo } from './forkWallet.js';

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

const emptyPreForkWallet = () =>
  PreForkWallet.restore(
    PreForkState.empty(),
    preFork,
    { appliedId: 0n, highestTransactionId: 0n },
    ProtocolVersion.MinSupportedVersion,
    networkId,
  );

const valuesOf = (utxos: readonly CarriedUtxo[]): readonly bigint[] => utxos.map((u) => u.value);

describe('unshielded hard-fork crossing', () => {
  it('carries every UTXO across and applies the boundary transaction exactly once, in the new variant', async () => {
    const wallet = makeForkWallet({ timeline, forkVersion, initialState: emptyPreForkWallet() });

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
    const wallet = makeForkWallet({ timeline, forkVersion, initialState: emptyPreForkWallet() });

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
    const wallet = makeForkWallet({ timeline: withinRange, forkVersion, initialState: emptyPreForkWallet() });

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
    const wallet = makeForkWallet({ timeline, forkVersion, initialState: emptyPreForkWallet() });

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
