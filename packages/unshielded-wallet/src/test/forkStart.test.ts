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
 *   Where it begins turns on one question: whether it asked the chain. A wallet given a way to ask starts at the variant
 *   that owns the version the chain reports, which on a chain past the boundary is the post-fork one from the first
 *   moment — no hand-over, and the right epoch before a single message has arrived. A wallet with no way to ask, or one
 *   whose question went unanswered, begins on the pre-fork variant, because that is where a wallet with no history
 *   belongs, and hands over on the first batch it sees. Both are specified here: the second is not a fallback in name
 *   only, it is what every offline-first application and every wallet built without a probe does. An identity only the
 *   post-fork ledger version can hold is the one start no question is asked for, because there is nothing to decide.
 *
 *   Unshielded's hand-over is a **structural carry** rather than a fresh state plus replay, so the "applied nothing"
 *   start is asserted for what a carry of nothing actually looks like: an empty carry, a cursor still at the start, and
 *   a post-fork variant that then syncs the whole history itself. Nothing is re-earned from a replay here, because
 *   there is nothing shielded to re-derive.
 *
 *   Both starts assert the boundary by comparison with `forkVersion` and never by the number itself: which protocol
 *   version a chain reports is a property of the chain, and the real fork's value is not final.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  NetworkId,
  ProtocolVersion,
  ProtocolVersionMismatchError,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { Cause, Effect, Either, Fiber, Option, Runtime, type Scope } from 'effect';
import { describe, expect, it } from 'vitest';
import { peekProtocolVersion } from '../Restore.js';
import { V1Tag } from '../v1/RunningV1Variant.js';
import { type SignSegment } from '../v2/Signing.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type UtxoWithMeta } from '../v2/UnshieldedState.js';
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
  chainVersionProbe?: ChainVersionProbe,
): Effect.Effect<ForkWallet, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wallet = yield* makeForkWallet({
      timeline: chainAt(protocolVersion),
      forkVersion,
      publicKey,
      ...(chainVersionProbe !== undefined ? { chainVersionProbe } : {}),
    });
    yield* Effect.addFinalizer(() => wallet.stop);
    yield* wallet.start;
    return wallet;
  });

/** A probe answering as a chain on `version` would. */
const chainReporting =
  (version: number): ChainVersionProbe =>
  () =>
    Promise.resolve(ProtocolVersion.ProtocolVersion(BigInt(version)));

/**
 * A probe that never answers.
 *
 * @remarks
 *   One shape stands in for every way the question can go unanswered — no indexer, no network, a request that outlives
 *   the wallet's patience — because the wallet distinguishes none of them: it asked, it has no answer, it starts where
 *   a wallet that never asked starts.
 */
const unreachableChain: ChainVersionProbe = () => Promise.reject(new Error('the indexer cannot be reached'));

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

/** A transaction of the pre-fork ledger version, sealed as an application would seal one it built for itself. */
const someTransaction = (): AnyTx =>
  WalletTransaction.adopt('Unproven', v8.Transaction.fromParts(networkId), ProtocolVersion.MinSupportedVersion);

/** The same transaction, proven and bound. */
const someFinalizedTransaction = (): AnyTx =>
  WalletTransaction.adopt(
    'Finalized',
    v8.Transaction.fromParts(networkId).mockProve(),
    ProtocolVersion.MinSupportedVersion,
  );

/**
 * The same transaction at the unbound stage.
 *
 * @remarks
 *   Only a prover produces one — `mockProve` binds as it proves — and a unit-tier proof has no prover. The handle seals
 *   the stage as data, so what a caller declares here is what the wallet routes on.
 */
const someUnboundTransaction = (): AnyTx =>
  WalletTransaction.adopt('Unbound', v8.Transaction.fromParts(networkId), ProtocolVersion.MinSupportedVersion);

/** A transaction of the post-fork ledger version, sealed at the version the post-fork variant answers for. */
const postForkTransaction = (): AnyTx =>
  WalletTransaction.adopt('Unproven', v9.Transaction.fromParts(networkId), forkVersion);

const signSegment: SignSegment = (data) => Promise.resolve(v9.signData(v9.sampleSigningKey(), data));

/** One of the UTxOs the wallet has actually synchronized, in the shape its own API takes. */
const heldUtxo = (wallet: ForkWallet): Effect.Effect<UtxoWithMeta, WalletRuntimeError> =>
  wallet.currentState.pipe(
    Effect.map((state) => {
      const [held] = utxosOf(state.state);
      return {
        utxo: {
          value: held.value,
          owner: held.owner,
          type: held.type,
          intentHash: held.intentHash,
          outputNo: held.outputNo,
        },
        meta: { ctime: new Date(held.ctime), registeredForDustGeneration: false },
      };
    }),
  );

/**
 * Every call that builds, balances or signs a transaction, named as the wallet names it.
 *
 * @remarks
 *   `revertTransaction` is deliberately not among them — see the test below for what it does instead.
 */
const transactionBuildingCalls = (wallet: ForkWallet): readonly (readonly [string, () => Promise<unknown>])[] => {
  const ttl = new Date(Date.now() + 3_600_000);
  const verifyingKey = v9.signatureVerifyingKey(v9.sampleSigningKey());
  return [
    ['balanceFinalizedTransaction', () => wallet.unshielded.balanceFinalizedTransaction(someFinalizedTransaction())],
    ['balanceUnboundTransaction', () => wallet.unshielded.balanceUnboundTransaction(someUnboundTransaction())],
    ['balanceUnprovenTransaction', () => wallet.unshielded.balanceUnprovenTransaction(someTransaction())],
    ['transferTransaction', () => wallet.unshielded.transferTransaction([], ttl)],
    [
      'rotateUtxos',
      // Rotation moves UTxOs the wallet holds, so it is given one of its own — the point is that the pre-fork variant
      // can do it, not that it can be asked to do nothing.
      async () => {
        const held = await Effect.runPromise(heldUtxo(wallet));
        return wallet.unshielded.rotateUtxos([held], [], verifyingKey, ttl);
      },
    ],
    ['initSwap', () => wallet.unshielded.initSwap({}, [], ttl)],
    ['signUnprovenTransaction', () => wallet.unshielded.signUnprovenTransaction(someTransaction(), signSegment)],
    ['signUnboundTransaction', () => wallet.unshielded.signUnboundTransaction(someUnboundTransaction(), signSegment)],
  ];
};

describe('an unshielded wallet that asks the chain where it is starting', () => {
  it('starts on the post-fork variant of a chain past the boundary, without a hand-over at all', async () =>
    Effect.gen(function* () {
      const wallet = yield* makeForkWallet({
        timeline: chainAt(afterFork),
        forkVersion,
        publicKey: postFork,
        chainVersionProbe: chainReporting(afterFork),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      // Before sync has been started, before any message exists to learn from: the variant is already the post-fork
      // one. The pre-fork variant is not where this wallet began and then left — it never ran.
      expect(yield* wallet.activeTag).toBe(V2Tag);

      const settled = yield* Effect.fork(
        wallet.awaitState((state) => state.state.progress.appliedId === 2n).pipe(Effect.orDie),
      );
      yield* wallet.start;

      const final = yield* Fiber.join(settled);
      expect(valuesOf(utxosOf(final.state))).toEqual([100n, 200n]);
      expect(final.state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);

      // Nothing was carried, because nothing was left behind. This is what the hand-over below costs a wallet that
      // could not ask.
      expect(yield* wallet.migration).toStrictEqual(Option.none());
      expect(yield* wallet.activeTag).toBe(V2Tag);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('starts on the pre-fork variant of a chain that has not forked, and stays there', async () =>
    Effect.gen(function* () {
      const wallet = yield* walletOnChainAt(beforeFork, postFork, chainReporting(beforeFork));
      yield* wallet.awaitState((state) => state.state.progress.appliedId === 2n).pipe(Effect.orDie);

      // The answer sends it to the variant that owns the version, which below the boundary is the one it would have
      // started on anyway. What the probe changes here is nothing at all, which is the claim.
      const settled = yield* wallet.currentState;
      expect(valuesOf(utxosOf(settled.state))).toEqual([100n, 200n]);
      expect(settled.state.protocolVersion).toBeLessThan(forkVersion);
      expect(yield* wallet.activeTag).toBe(V1Tag);
      expect(yield* wallet.migration).toStrictEqual(Option.none());
    }).pipe(Effect.scoped, Effect.runPromise));

  it('asks nothing for an identity only the post-fork ledger version can hold', async () =>
    Effect.gen(function* () {
      // A chain below the boundary, and an answer saying so, and the wallet still starts post-fork: an ecdsa identity
      // has no pre-fork shape, so there is no decision for the chain to inform. The probe resolves where a wallet may
      // start, never where it can.
      const ecdsa = ecdsaIdentity(networkId);

      const wallet = yield* walletOnChainAt(beforeFork, ecdsa, chainReporting(beforeFork));

      expect(yield* wallet.activeTag).toBe(V2Tag);
      const state = yield* wallet.currentState;
      expect(state.state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(yield* wallet.migration).toStrictEqual(Option.none());
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('an unshielded wallet starting on a chain that has already forked', () => {
  it('hands over having applied nothing, carrying nothing, and syncs the whole chain on the post-fork variant', async () =>
    Effect.gen(function* () {
      // No probe: the shape of every wallet built without one, and of every application that would rather not have
      // its start depend on reaching an indexer.
      const wallet = yield* makeForkWallet({ timeline: chainAt(afterFork), forkVersion, publicKey: postFork });
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

  it('hands over the same way when it asked the chain and got no answer', async () =>
    Effect.gen(function* () {
      const wallet = yield* makeForkWallet({
        timeline: chainAt(afterFork),
        forkVersion,
        publicKey: postFork,
        chainVersionProbe: unreachableChain,
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      const settled = yield* Effect.fork(
        wallet.awaitState((state) => state.state.progress.appliedId === 2n).pipe(Effect.orDie),
      );
      yield* wallet.start;

      // A question that cannot be answered leaves the wallet exactly where a wallet that never asked would be — and,
      // above all, leaves it started. An unreachable chain is not a reason to fail to start.
      const migration = yield* wallet.awaitMigration;
      expect(migration.from.appliedId).toBe(0n);

      const final = yield* Fiber.join(settled);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(valuesOf(utxosOf(final.state))).toEqual([100n, 200n]);
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
    'initSwap',
    'signUnprovenTransaction',
    'signUnboundTransaction',
  ])('answers %s while it is still pre-fork, with the ledger version the chain is on', async (operation) =>
    Effect.gen(function* () {
      const wallet = yield* syncedPreForkWallet;

      const call = transactionBuildingCalls(wallet).find(([name]) => name === operation)!;
      const answer = yield* Effect.promise(call[1]);

      // It answered rather than refusing, and whatever it produced is stamped with the ledger version the chain is
      // actually on. The balancing calls may legitimately produce nothing — a transaction needing no Night of this
      // wallet's needs no unshielded balancing.
      if (answer !== undefined) {
        expect(WalletTransaction.is(answer)).toBe(true);
        expect((answer as AnyTx).protocolVersion).toBeLessThan(forkVersion);
      }
      expect(yield* wallet.activeTag).toBe(V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it('builds with the pre-fork ledger version itself, not merely with something', async () =>
    Effect.gen(function* () {
      // The refusal this replaced could be satisfied by any wallet at all; this cannot. What comes back is an object
      // of the previous ledger version's own `Transaction` class — the thing the post-fork variant provably cannot
      // produce, and the whole reason the handle exists.
      const wallet = yield* syncedPreForkWallet;

      const built = yield* Effect.promise(() =>
        wallet.unshielded.transferTransaction([], new Date(Date.now() + 3_600_000)),
      );

      const carried = Either.getOrThrow(
        WalletTransaction.unwrapWithin<v8.UnprovenTransaction>(
          built,
          ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, forkVersion),
        ),
      );
      expect(carried).toBeInstanceOf(v8.Transaction);
      expect(carried).not.toBeInstanceOf(v9.Transaction);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('rotates UTxOs on the pre-fork variant, with the pre-fork ledger', async () =>
    Effect.gen(function* () {
      // The UTxO handed in is one the wallet really synchronized, and the timeline's UTxOs are ledger-readable, so
      // this rotation completes — which is what makes the routing assertable on the answer rather than on a refusal:
      // the call reaches the pre-fork variant's own transacting and is answered by the pre-fork *ledger*, so what
      // comes back is a v8 transaction sealed below the boundary.
      const wallet = yield* syncedPreForkWallet;
      const held = yield* heldUtxo(wallet);

      const built = yield* Effect.promise(() =>
        wallet.unshielded.rotateUtxos(
          [held],
          [],
          v9.signatureVerifyingKey(v9.sampleSigningKey()),
          new Date(Date.now() + 3_600_000),
        ),
      );

      const carried = Either.getOrThrow(
        WalletTransaction.unwrapWithin<v8.UnprovenTransaction>(
          built,
          ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, forkVersion),
        ),
      );
      expect(carried).toBeInstanceOf(v8.Transaction);
      expect(carried).not.toBeInstanceOf(v9.Transaction);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('refuses a transaction built on the other side of the boundary, naming both versions', async () =>
    Effect.gen(function* () {
      const wallet = yield* syncedPreForkWallet;

      const failure = Option.getOrThrow(
        yield* failureOf(wallet.unshielded.balanceUnprovenTransaction(postForkTransaction())),
      );

      expect(failure).toBeInstanceOf(ProtocolVersionMismatchError);
      expect(failure).toMatchObject({ authoredFor: forkVersion });
    }).pipe(Effect.scoped, Effect.runPromise));

  it('refuses a signer that answers with a scheme the pre-fork ledger version does not have', async () =>
    Effect.gen(function* () {
      // The one scalar that genuinely changed shape at the fork. The SDK's signing callback speaks the current ledger
      // version's signature, and an ecdsa one has no pre-fork encoding at all.
      const wallet = yield* syncedPreForkWallet;
      const ecdsaSigner: SignSegment = () => Promise.resolve({ tag: 'ecdsa', value: '00'.repeat(64) });
      // A transaction with a segment to sign: an empty one asks the signer nothing, and the point here is what the
      // signer answers with.
      const toSign = WalletTransaction.adopt(
        'Unproven',
        v8.Transaction.fromParts(networkId, undefined, undefined, v8.Intent.new(new Date(Date.now() + 3_600_000))),
        ProtocolVersion.MinSupportedVersion,
      );

      const failure = Option.getOrThrow(
        yield* failureOf(wallet.unshielded.signUnprovenTransaction(toSign, ecdsaSigner)),
      );

      // The signing service reports a signer that raised as a `SignError`, carrying what it raised: the typed refusal
      // naming the scheme the pre-fork ledger version does not have.
      expect(failure).toMatchObject({ cause: { kind: 'ecdsa' } });
    }).pipe(Effect.scoped, Effect.runPromise));

  it('reverts a transaction of the other epoch by doing nothing to its state', async () =>
    Effect.gen(function* () {
      // Reverting releases UTXOs a transaction booked, and a transaction of the other ledger version cannot have
      // booked any of this variant's. So this resolves, changes nothing, and is deliberately not a version mismatch:
      // the facade reverts all three wallets together when a submission fails, and a refusal here would strand that
      // whole path.
      const wallet = yield* syncedPreForkWallet;

      yield* Effect.promise(() => wallet.unshielded.revertTransaction(postForkTransaction()));

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

/**
 * An unshielded wallet on a chain past the boundary that has shown it nothing.
 *
 * @remarks
 *   The hazard the probe closes, and the reason it is a correctness item rather than an optimization. A wallet learns the
 *   chain's version from the messages it observes, so one that has observed none holds the only version it can assume:
 *   the bottom of the timeline. That is not a transient state on a chain whose timeline contains nothing addressed to
 *   this wallet — it is where the wallet stays, for as long as it runs. And since transacting works on either side of
 *   the boundary, the wallet does not refuse: it builds with the wrong ledger version, against a chain that will reject
 *   the result.
 *
 *   Modelled by an empty timeline, which is exactly that chain: sync runs, and there is nothing for it to deliver.
 */
describe('an unshielded wallet on a chain that has shown it no messages', () => {
  const walletOnSilentChain = (chainVersionProbe?: ChainVersionProbe): Effect.Effect<ForkWallet, never, Scope.Scope> =>
    Effect.gen(function* () {
      const wallet = yield* makeForkWallet({
        timeline: [],
        forkVersion,
        publicKey: postFork,
        ...(chainVersionProbe !== undefined ? { chainVersionProbe } : {}),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;
      return wallet;
    });

  it('believes it is pre-fork, and refuses the chain’s own transactions, when it never asked', async () =>
    Effect.gen(function* () {
      const wallet = yield* walletOnSilentChain();

      const failure = Option.getOrThrow(
        yield* failureOf(wallet.unshielded.balanceUnprovenTransaction(postForkTransaction())),
      );

      // A transaction of the ledger version this chain actually runs, refused by a wallet sitting on the same chain.
      expect(failure).toBeInstanceOf(ProtocolVersionMismatchError);
      expect(yield* wallet.activeTag).toBe(V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('is in the epoch the chain is in, having asked it', async () =>
    Effect.gen(function* () {
      const wallet = yield* walletOnSilentChain(chainReporting(afterFork));

      // Same wallet, same silent chain, one question asked: the transaction is now one this wallet can read, and the
      // variant holding it is the one the chain is on.
      expect(yield* failureOf(wallet.unshielded.balanceUnprovenTransaction(postForkTransaction()))).toStrictEqual(
        Option.none(),
      );
      expect(yield* wallet.activeTag).toBe(V2Tag);
    }).pipe(Effect.scoped, Effect.runPromise));
});
