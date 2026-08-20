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
 * Where an unshielded wallet spanning a protocol boundary starts, and what it cannot do until it has crossed it.
 *
 * @remarks
 *   `forkSimulation.test.ts` drives the crossing itself: a timeline that forks under a running wallet. The two starts
 *   here are the other question — a wallet meeting a chain that is already on one side or the other, which is what
 *   every application start actually is.
 *
 *   A wallet always begins on the pre-fork variant, because that is the variant a wallet with no history belongs to. On a
 *   chain that has already forked it therefore hands over immediately, having applied nothing: one migration per start,
 *   paid on chains that are entirely past the boundary. That cost is accepted rather than hidden — removing it means
 *   asking the chain for its version before choosing a variant, which is a separate piece of work.
 *
 *   Unshielded's hand-over is a **structural carry** rather than a fresh state plus replay, so the "applied nothing"
 *   start is asserted for what a carry of nothing actually looks like: an empty carry, a cursor still at the start, and
 *   a post-fork variant that then syncs the whole history itself. Nothing is re-earned from a replay here, because
 *   there is nothing shielded to re-derive.
 *
 *   Both starts assert the boundary by comparison with `forkVersion` and never by the number itself: which protocol
 *   version a chain reports is a property of the chain, and the real fork's value is not final.
 */

import * as v9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Cause, Effect, Fiber, Option, Runtime, type Scope } from 'effect';
import { describe, expect, it } from 'vitest';
import { PreForkUnshieldedTransactingUnsupportedError } from '../ForkingUnshieldedWallet.js';
import { peekProtocolVersion } from '../Restore.js';
import { V1Tag } from '../v1/RunningV1Variant.js';
import { type SignSegment } from '../v2/Signing.js';
import { type UnboundTransaction } from '../v2/TransactionOps.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import { type CarriedUtxo, type ForkWallet, makeForkWallet, utxosOf } from './forkHarness.js';
import { ecdsaIdentity, postForkIdentity, preForkIdentity, timelineTransaction } from './forkTimeline.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its post-fork variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has already forked — deliberately past the boundary rather than exactly at it. */
const afterFork = 9;
/** A chain that has not — a version the pre-fork variant owns. */
const beforeFork = 5;

const postFork = postForkIdentity(networkId);
const preFork = preForkIdentity(networkId);

/** The whole history of a chain sitting on one side of the boundary: every message reported at the same version. */
const chainAt = (protocolVersion: number) => [
  timelineTransaction({ id: 1, protocolVersion, owner: postFork.addressHex, value: 100n }),
  timelineTransaction({ id: 2, protocolVersion, owner: postFork.addressHex, value: 200n }),
];

const valuesOf = (utxos: readonly CarriedUtxo[]): readonly bigint[] => utxos.map((u) => u.value);

/** A started wallet that has consumed the whole of `timeline`, torn down when the surrounding scope closes. */
const walletOnChainAt = (
  protocolVersion: number,
  publicKey = postFork,
): Effect.Effect<ForkWallet, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wallet = makeForkWallet({ timeline: chainAt(protocolVersion), forkVersion, publicKey });
    yield* Effect.addFinalizer(() => wallet.stop);
    yield* wallet.start;
    return wallet;
  });

/** A wallet on a chain that has not forked, synchronized and holding its UTXOs. */
const syncedPreForkWallet: Effect.Effect<ForkWallet, never, Scope.Scope> = Effect.gen(function* () {
  const wallet = yield* walletOnChainAt(beforeFork);
  yield* wallet.awaitState((state) => state.state.progress.appliedId === 2n).pipe(Effect.orDie);
  expect(yield* wallet.activeTag).toBe(V1Tag);
  return wallet;
});

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

/** A transaction of the post-fork ledger version, which is the only kind this wallet's API accepts. */
const someTransaction = (): v9.UnprovenTransaction => v9.Transaction.fromParts(networkId);

/** The same transaction, proven and bound. */
const someFinalizedTransaction = (): v9.FinalizedTransaction => someTransaction().mockProve();

/**
 * The same transaction at the unbound stage.
 *
 * @remarks
 *   Only a prover produces one — `mockProve` binds as it proves — and a unit-tier proof has no prover.
 */
// Type cast required because: the unbound stage is reachable only through a real proving provider, which this tier
// deliberately does not have, and `Binding`/`PreBinding` are nominal. The gated branch refuses before touching the
// argument, so what is load-bearing here is the static type of the parameter and never the value.
const someUnboundTransaction = (): UnboundTransaction => someTransaction() as unknown as UnboundTransaction;

const signSegment: SignSegment = (data) => Promise.resolve(v9.signData(v9.sampleSigningKey(), data));

/**
 * Every call that builds, balances or signs a transaction, named as the wallet names it.
 *
 * @remarks
 *   `revertTransaction` is deliberately not among them — see the test below for what it does instead.
 */
const gatedCalls = (wallet: ForkWallet): readonly (readonly [string, () => Promise<unknown>])[] => {
  const ttl = new Date(Date.now() + 3_600_000);
  const verifyingKey = v9.signatureVerifyingKey(v9.sampleSigningKey());
  return [
    ['balanceFinalizedTransaction', () => wallet.unshielded.balanceFinalizedTransaction(someFinalizedTransaction())],
    ['balanceUnboundTransaction', () => wallet.unshielded.balanceUnboundTransaction(someUnboundTransaction())],
    ['balanceUnprovenTransaction', () => wallet.unshielded.balanceUnprovenTransaction(someTransaction())],
    ['transferTransaction', () => wallet.unshielded.transferTransaction([], ttl)],
    ['rotateUtxos', () => wallet.unshielded.rotateUtxos([], [], verifyingKey, ttl)],
    ['initSwap', () => wallet.unshielded.initSwap({}, [], ttl)],
    ['signUnprovenTransaction', () => wallet.unshielded.signUnprovenTransaction(someTransaction(), signSegment)],
    ['signUnboundTransaction', () => wallet.unshielded.signUnboundTransaction(someUnboundTransaction(), signSegment)],
  ];
};

describe('an unshielded wallet starting on a chain that has already forked', () => {
  it('hands over having applied nothing, carrying nothing, and syncs the whole chain on the post-fork variant', async () =>
    Effect.gen(function* () {
      const wallet = makeForkWallet({ timeline: chainAt(afterFork), forkVersion, publicKey: postFork });
      yield* Effect.addFinalizer(() => wallet.stop);
      // Subscribed BEFORE starting: `stateChanges` does not replay, so a settled state reached while nobody was
      // listening would be missed and the wait would hang rather than fail.
      const settled = yield* Effect.fork(
        wallet.awaitState((state) => state.state.progress.appliedId === 2n).pipe(Effect.orDie),
      );
      yield* wallet.start;

      const migration = yield* wallet.awaitMigration;

      // The chain is past the boundary, so the pre-fork variant owns none of it: it read the version off the first
      // message, applied nothing, and handed over with a cursor that has not moved.
      expect(migration.from.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(migration.from.appliedId).toBe(0n);
      expect(migration.from.utxos).toEqual([]);

      // Unshielded's hand-over is a structural carry, so a start that applied nothing carries nothing — and this is
      // where it differs from shielded and dust, which start empty by design and wait for a replay. There is no replay
      // here: the cursor is still at the beginning, so the post-fork variant simply syncs the chain itself.
      expect(migration.to.utxos).toEqual([]);
      expect(migration.to.appliedId).toBe(migration.from.appliedId);
      expect(migration.to.appliedId).toBe(0n);
      // Identity crosses, which is what lets the post-fork variant read anything addressed to this wallet at all.
      expect(migration.to.address).toBe(postFork.address);
      expect(migration.to.networkId).toBe(networkId);

      const final = yield* Fiber.join(settled);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(valuesOf(utxosOf(final.state))).toEqual([100n, 200n]);
      expect(final.state.progress.appliedId).toBe(2n);
      expect(final.state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('an unshielded wallet starting on a chain that has not forked', () => {
  it('syncs on the pre-fork variant and stays there, holding a pre-fork verifying key', async () =>
    Effect.gen(function* () {
      const wallet = yield* syncedPreForkWallet;

      const settled = yield* wallet.currentState;
      expect(valuesOf(utxosOf(settled.state))).toEqual([100n, 200n]);
      expect(settled.state.protocolVersion).toBeLessThan(forkVersion);
      expect(yield* wallet.activeTag).toBe(V1Tag);
      expect(yield* wallet.migration).toStrictEqual(Option.none());

      // The v8 signer world, intact: the identity the application handed over is a `{tag, value}` record, and what the
      // pre-fork variant holds is the bare hex the ledger version that owns it understands. The address is the same on
      // both sides, which is the whole reason the narrowing is lossless.
      expect(settled.state.publicKey.publicKey).toStrictEqual(preFork.publicKey);
      expect(typeof settled.state.publicKey.publicKey).toBe('string');
      expect(settled.state.publicKey.address).toBe(postFork.address);
    }).pipe(Effect.scoped, Effect.runPromise));

  it.each([
    'balanceFinalizedTransaction',
    'balanceUnboundTransaction',
    'balanceUnprovenTransaction',
    'transferTransaction',
    'rotateUtxos',
    'initSwap',
    'signUnprovenTransaction',
    'signUnboundTransaction',
  ])('refuses %s while it is still pre-fork, and says why', async (operation) =>
    Effect.gen(function* () {
      const wallet = yield* syncedPreForkWallet;

      const call = gatedCalls(wallet).find(([name]) => name === operation)!;
      const failure = Option.getOrThrow(yield* failureOf(call[1]()));

      // Typed, and naming the operation: the pre-fork branch cannot hold a transaction of the post-fork ledger
      // version, let alone produce one anybody can prove, and says so instead of producing one nobody can.
      expect(failure).toBeInstanceOf(PreForkUnshieldedTransactingUnsupportedError);
      expect(failure).toMatchObject({ operation });
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it('reverts a transaction it cannot have made, by doing nothing to its state', async () =>
    Effect.gen(function* () {
      // Reverting releases UTXOs a transaction booked, and no transaction of this wallet's can have booked any: it
      // could not have built one. So this resolves, changes nothing, and is deliberately not part of the seam above —
      // it needs no proving. The facade reverts all three wallets together when a submission fails, and a refusal here
      // would strand that whole path.
      const wallet = yield* syncedPreForkWallet;

      yield* Effect.promise(() => wallet.unshielded.revertTransaction(someFinalizedTransaction()));

      const after = yield* wallet.currentState;
      expect(valuesOf(utxosOf(after.state))).toEqual([100n, 200n]);
      expect(yield* wallet.activeTag).toBe(V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('still reads its address and writes a snapshot naming the version it is on', async () =>
    Effect.gen(function* () {
      // Observation and serialization are version-agnostic on both sides of the boundary: an address is a scheme-less
      // hash and a snapshot is JSON. The declared version is what `restore` later routes on, so a pre-fork wallet must
      // write the pre-fork version rather than the one its API speaks.
      const wallet = yield* syncedPreForkWallet;

      const address = yield* Effect.promise(() => wallet.unshielded.getAddress());
      const snapshot = yield* Effect.promise(() => wallet.unshielded.serializeState());

      expect(address.hexString).toBe(postFork.addressHex);
      // Read back through the very function `restore` routes on, so the snapshot is pinned as the router sees it.
      expect(peekProtocolVersion(snapshot)).toStrictEqual(
        Option.some(ProtocolVersion.ProtocolVersion(BigInt(beforeFork))),
      );
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('an unshielded wallet whose identity the pre-fork ledger version cannot hold', () => {
  it('starts an ecdsa identity on the post-fork variant, and stays there on a chain that has not forked', async () =>
    Effect.gen(function* () {
      // The honest consequence of a scheme that did not exist pre-fork. Ledger-v8 keys are bare hex with no room to
      // name a scheme, and an ecdsa key derives a different address, so narrowing one to the pre-fork shape would
      // produce a wallet claiming an identity it does not have — and the migration back would relabel it `schnorr`.
      // Such a wallet therefore starts on the variant its key belongs to and stays there, exactly as a dust wallet
      // built from a post-fork secret key does.
      const ecdsa = ecdsaIdentity(networkId);
      expect(ecdsa.addressHex).not.toBe(postFork.addressHex);

      const wallet = yield* walletOnChainAt(beforeFork, ecdsa);

      expect(yield* wallet.activeTag).toBe(V2Tag);
      const state = yield* wallet.currentState;
      expect(state.state.publicKey.publicKey).toStrictEqual(ecdsa.publicKey);
      // Stamped with the boundary version rather than left at the minimum, so a variant that would otherwise find
      // itself outside its own activation range does not report that on sight and migrate away from itself.
      expect(state.state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(yield* wallet.migration).toStrictEqual(Option.none());
    }).pipe(Effect.scoped, Effect.runPromise));
});
