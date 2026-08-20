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
 * Where a dust wallet spanning a protocol boundary starts, and what it cannot do until it has crossed it.
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
 *   Both starts assert the boundary by comparison with `forkVersion` and never by the number itself: which protocol
 *   version a chain reports is a property of the chain, and the real fork's value is not final.
 */

import { LedgerParameters as PreForkLedgerParameters } from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Cause, Deferred, Effect, Option, Queue, Runtime, type Scope, Stream } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { PreForkDustTransactingUnsupportedError } from '../ForkingDustWallet.js';
import { V1Tag } from '../v1/RunningV1Variant.js';
import * as PreForkSync from '../v1/Sync.js';
import { DUST_EVENT_COUNT, type DustChain, buildDustChain, dustSeed } from '../v1/test/dustEvents.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import * as PostForkSync from '../v2/Sync.js';
import { dustParameters as postForkDustParameters } from '../v2/test/dustEvents.js';
import { type ForkWallet, makeForkWallet } from './forkHarness.js';
import { type TimelineEvent, numberedFrom } from './forkReplay.js';
import { balanceAt, dustCount } from './forkWalletAssertions.js';

// Building a real dust chain (rewards + registrations through WASM) does not fit vitest's 5s default on a CI runner.
vi.setConfig({ testTimeout: 60_000 });

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its post-fork variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has already forked — deliberately past the boundary rather than exactly at it. */
const afterFork = ProtocolVersion.ProtocolVersion(9n);
/** A chain that has not — a version the pre-fork variant owns. */
const beforeFork = ProtocolVersion.ProtocolVersion(5n);

const dustParameters = {
  preFork: PreForkLedgerParameters.initialParameters().dust,
  postFork: postForkDustParameters(),
};

/**
 * A wallet pointed at a timeline every event of which is reported at `version`.
 *
 * @remarks
 *   The whole history in one wire, and the same history again as the replay a post-fork variant would read. On a chain
 *   already past the boundary the pre-fork variant owns none of the first and the replay is what it hands over to; on a
 *   chain still below it the pre-fork variant owns all of the first and the replay is never reached.
 */
const walletOnChainAt = (
  chain: DustChain,
  version: ProtocolVersion.ProtocolVersion,
): Effect.Effect<ForkWallet, never, Scope.Scope> =>
  Effect.gen(function* () {
    const history: readonly TimelineEvent[] = numberedFrom(chain.eventBytes, 1, Number(version));
    const wire = yield* Queue.unbounded<readonly TimelineEvent[]>();
    const replayed = yield* Deferred.make<readonly TimelineEvent[]>();

    const wallet = makeForkWallet({
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

    yield* Queue.offer(wire, history);
    // The replay continues the indexer's id space from where the pre-fork history left off only when there *was*
    // pre-fork history. On a chain entirely past the boundary the pre-fork variant applied nothing, so its cursor is
    // still at zero and the replay opens at the first id.
    yield* Deferred.succeed(replayed, history);

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

const signingKey = (): v9.SigningKey => v9.sampleSigningKey();

/**
 * Every call that builds, signs or prices a transaction, named as the wallet names it.
 *
 * @remarks
 *   `revertTransaction` and `splitNightUtxosForDustRegistration` are deliberately not among them — see the tests below
 *   for what they do instead.
 */
const gatedCalls = (wallet: ForkWallet): readonly (readonly [string, () => Promise<unknown>])[] => {
  const ttl = new Date(Date.now() + 3_600_000);
  const verifyingKey = v9.signatureVerifyingKey(signingKey());
  const signature = v9.signData(signingKey(), new Uint8Array([1, 2, 3]));
  return [
    [
      'createDustGenerationTransaction',
      () => wallet.dust.createDustGenerationTransaction(undefined, ttl, [], verifyingKey, undefined),
    ],
    [
      'attachDustRegistration',
      () => wallet.dust.attachDustRegistration(someTransaction(), new Date(), verifyingKey, undefined, 0n),
    ],
    ['addDustGenerationSignature', () => wallet.dust.addDustGenerationSignature(someTransaction(), signature)],
    ['addDustRegistrationSignature', () => wallet.dust.addDustRegistrationSignature(someTransaction(), signature)],
    ['calculateFee', () => wallet.dust.calculateFee([someTransaction()])],
    ['estimateFee', () => wallet.dust.estimateFee(wallet.keys.postFork, [someTransaction()])],
    ['balanceTransactions', () => wallet.dust.balanceTransactions(wallet.keys.postFork, [someTransaction()], ttl)],
  ];
};

/** A wallet on a chain that has not forked, synchronized and holding its dust. */
const syncedPreForkWallet: Effect.Effect<ForkWallet, WalletRuntimeError, Scope.Scope> = Effect.gen(function* () {
  const chain = yield* Effect.promise(() => buildDustChain());
  const wallet = yield* walletOnChainAt(chain, beforeFork);

  yield* wallet.awaitState((state) => dustCount(state.state) === DUST_EVENT_COUNT);
  expect(yield* wallet.activeTag).toBe(V1Tag);

  return wallet;
});

describe('a dust wallet starting on a chain that has already forked', () => {
  it('hands over on the first batch, having applied nothing, and syncs on the post-fork variant', async () =>
    Effect.gen(function* () {
      const chain = yield* Effect.promise(() => buildDustChain());
      const wallet = yield* walletOnChainAt(chain, afterFork);

      const migration = yield* wallet.awaitMigration;

      // The chain is past the boundary, so the pre-fork variant owns none of it: it read the version, applied no
      // event, and handed over with a cursor that has not moved.
      expect(migration.from.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(migration.from.appliedIndex).toBe(0n);
      expect(migration.to.dustCount).toBe(0);
      // Identity crosses, which is what lets the post-fork variant read anything addressed to this wallet at all.
      expect(migration.to.dustPublicKey).toBe(v9.DustSecretKey.fromSeed(dustSeed()).publicKey);

      // And the post-fork variant does the syncing, having been started with key material of its own ledger version.
      const synced = yield* wallet.awaitState((state) => dustCount(state.state) === DUST_EVENT_COUNT);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(synced.state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(balanceAt(synced.state, chain.syncTime)).toBeGreaterThan(0n);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('a dust wallet starting on a chain that has not forked', () => {
  it('syncs on the pre-fork variant and stays there', async () =>
    Effect.gen(function* () {
      const chain = yield* Effect.promise(() => buildDustChain());
      const wallet = yield* walletOnChainAt(chain, beforeFork);

      // Everything the chain has, read by the ledger version that produced it — from a seed, which is the only key
      // material that answers for a variant the wallet's own API does not speak.
      const synced = yield* wallet.awaitState((state) => dustCount(state.state) === DUST_EVENT_COUNT);
      expect(balanceAt(synced.state, chain.syncTime)).toBeGreaterThan(0n);
      expect(synced.state.protocolVersion).toBeLessThan(forkVersion);

      expect(yield* wallet.activeTag).toBe(V1Tag);
      expect(yield* wallet.migration).toStrictEqual(Option.none());
    }).pipe(Effect.scoped, Effect.runPromise));

  it.each([
    'createDustGenerationTransaction',
    'attachDustRegistration',
    'addDustGenerationSignature',
    'addDustRegistrationSignature',
    'calculateFee',
    'estimateFee',
    'balanceTransactions',
  ])('refuses %s while it is still pre-fork, and says why', async (operation) =>
    Effect.gen(function* () {
      const wallet = yield* syncedPreForkWallet;

      const call = gatedCalls(wallet).find(([name]) => name === operation)!;
      const failure = Option.getOrThrow(yield* failureOf(call[1]()));

      // Typed, and naming the operation: the pre-fork branch cannot produce a transaction anybody can prove, and says
      // so instead of producing one nobody can.
      expect(failure).toBeInstanceOf(PreForkDustTransactingUnsupportedError);
      expect(failure).toMatchObject({ operation });
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it('reverts a transaction it cannot have made, by doing nothing to its state', async () =>
    Effect.gen(function* () {
      // Reverting releases dust a transaction booked, and no transaction of this wallet's can have booked any: it
      // could not have built one. So this resolves, changes nothing, and is deliberately not part of the seam above —
      // it needs no proving. The facade reverts all three wallets together when a submission fails, and a refusal here
      // would strand that whole path.
      const wallet = yield* syncedPreForkWallet;

      yield* Effect.promise(() => wallet.dust.revertTransaction(someTransaction()));

      const after = yield* wallet.currentState;
      expect(dustCount(after.state)).toBe(DUST_EVENT_COUNT);
      expect(yield* wallet.activeTag).toBe(V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('still splits Night UTxOs for a registration, which needs no proving at all', async () =>
    Effect.gen(function* () {
      // Plain arithmetic over plain data — no ledger object crosses it — so the pre-fork variant answers it exactly as
      // the post-fork one does. Gating it would break fee estimation on a chain that has not forked yet, for no reason.
      const wallet = yield* syncedPreForkWallet;

      const split = yield* Effect.promise(() => wallet.dust.splitNightUtxosForDustRegistration(new Date(), [], true));

      expect(split.guaranteedUtxos).toEqual([]);
      expect(split.fallibleUtxos).toEqual([]);
      expect(yield* wallet.activeTag).toBe(V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('projections fast-sync and the two-variant wallet', () => {
  it('is a post-fork capability the pre-fork variant does not have and never will', () => {
    // The load-bearing fact behind the finding below, asserted rather than asserted-in-prose: the projections path
    // exists only on the post-fork variant. It needs `DustLocalState` APIs no published pre-fork ledger has, so this
    // is permanent rather than a gap to be closed — the pre-fork variant syncs by event replay, full stop.
    expect(PostForkSync.makeEventLessSyncService).toBeDefined();
    expect(PostForkSync.makeEventLessSyncCapability).toBeDefined();
    expect('makeEventLessSyncService' in PreForkSync).toBe(false);
    expect('makeEventLessSyncCapability' in PreForkSync).toBe(false);
  });

  it('is therefore reachable only through a single-variant composition', async () =>
    Effect.gen(function* () {
      // What the flip actually costs the fast-sync path: a two-variant wallet begins on the pre-fork variant no matter
      // what the chain reports, so even on a chain entirely past the boundary it boots a variant that cannot fast-sync
      // — and only reaches the post-fork one after a migration. A wallet that wants projections therefore composes a
      // *single* post-fork variant (`CustomDustWallet` + `makeEventLessSyncService`, as `docs-snippets`'
      // `dust-fast-sync.ts` does), which is unaffected by the flip.
      const chain = yield* Effect.promise(() => buildDustChain());
      const wallet = yield* walletOnChainAt(chain, afterFork);

      // It boots the events variant even though every event it will ever see is post-fork.
      expect(yield* wallet.activeTag).toBe(V1Tag);
      yield* wallet.awaitMigration;
      expect(yield* wallet.activeTag).toBe(V2Tag);
    }).pipe(Effect.scoped, Effect.runPromise));
});
