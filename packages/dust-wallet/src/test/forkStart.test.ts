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
 *   Where it begins turns on one question: whether it asked the chain. A wallet given a way to ask starts at the variant
 *   that owns the version the chain reports, which on a chain past the boundary is the ledger-v9 one from the first
 *   moment — no hand-over, and the right epoch before a single event has arrived. A wallet with no way to ask, or one
 *   whose question went unanswered, begins on the V1 variant, because that is where a wallet with no history belongs,
 *   and hands over on the first batch it sees. Both are specified here: the second is not a fallback in name only, it
 *   is what every offline-first application and every wallet built without a probe does.
 *
 *   All of it asserts the boundary by comparison with `forkVersion` and never by the number itself: which protocol
 *   version a chain reports is a property of the chain, and the real fork's value is not final.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import { LedgerParameters as V8LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  NetworkId,
  ProtocolVersion,
  ProtocolVersionMismatchError,
  type UnprovenTx,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { Cause, Deferred, Effect, Option, Queue, Runtime, type Scope, Stream } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { V1Tag } from '../v1/RunningV1Variant.js';
import * as V1Sync from '../v1/Sync.js';
import { DUST_EVENT_COUNT, type DustChain, buildDustChain, dustSeed } from '../v1/test/dustEvents.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import * as V2Sync from '../v2/Sync.js';
import { dustParameters as v9DustParameters } from '../v2/test/dustEvents.js';
import { type ForkWallet, makeForkWallet } from './forkHarness.js';
import { type TimelineEvent, numberedFrom } from './forkReplay.js';
import { balanceAt, dustCount } from './forkWalletAssertions.js';

// Building a real dust chain (rewards + registrations through WASM) does not fit vitest's 5s default on a CI runner.
vi.setConfig({ testTimeout: 60_000 });

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its V2 variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has already forked — deliberately past the boundary rather than exactly at it. */
const v9Version = ProtocolVersion.ProtocolVersion(9n);
/** A chain that has not — a version the V1 variant owns. */
const v8Version = ProtocolVersion.ProtocolVersion(5n);

const dustParameters = {
  v8: V8LedgerParameters.initialParameters().dust,
  v9: v9DustParameters(),
};

/**
 * A wallet pointed at a timeline every event of which is reported at `version`.
 *
 * @remarks
 *   The whole history in one wire, and the same history again as the replay a V2 variant would read. On a chain already
 *   past the boundary the V1 variant owns none of the first and the replay is what it hands over to; on a chain still
 *   below it the V1 variant owns all of the first and the replay is never reached.
 */
const walletOnChainAt = (
  chain: DustChain,
  version: ProtocolVersion.ProtocolVersion,
  chainVersionProbe?: ChainVersionProbe,
): Effect.Effect<ForkWallet, never, Scope.Scope> =>
  Effect.gen(function* () {
    const history: readonly TimelineEvent[] = numberedFrom(chain.eventBytes, 1, Number(version));
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
      ...(chainVersionProbe !== undefined ? { chainVersionProbe } : {}),
    });
    yield* Effect.addFinalizer(() => wallet.stop);
    yield* wallet.start;

    yield* Queue.offer(wire, history);
    // The replay continues the indexer's id space from where the ledger-v8 history left off only when there *was*
    // ledger-v8 history. On a chain entirely past the boundary the V1 variant applied nothing, so its cursor is
    // still at zero and the replay opens at the first id.
    yield* Deferred.succeed(replayed, history);

    return wallet;
  });

/** A probe answering as a chain on `version` would. */
const chainReporting =
  (version: ProtocolVersion.ProtocolVersion): ChainVersionProbe =>
  () =>
    Promise.resolve(version);

/**
 * A probe that never answers.
 *
 * @remarks
 *   One shape stands in for every way the question can go unanswered — no indexer, no network, a request that outlives
 *   the wallet's patience — because the wallet distinguishes none of them: it asked, it has no answer, it starts where
 *   a wallet that never asked starts.
 */
const unreachableChain: ChainVersionProbe = () => Promise.reject(new Error('the indexer cannot be reached'));

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

/** A transaction of the ledger-v8, sealed as an application would seal one it built for itself. */
const v8Transaction = (): UnprovenTx =>
  WalletTransaction.adopt('Unproven', ledgerV8.Transaction.fromParts(networkId), ProtocolVersion.MinSupportedVersion);

/** A transaction of the ledger-v9, sealed at the version the V2 variant answers for. */
const v9Transaction = (): AnyTx =>
  WalletTransaction.adopt('Unproven', ledgerV9.Transaction.fromParts(networkId), forkVersion);

const signingKey = (): ledgerV9.SigningKey => ledgerV9.sampleSigningKey();

/** A Night UTxO the verifying key owns, as plain data — the shape both ledger versions read identically. */
const nightUtxo = (verifyingKey: ledgerV9.SignatureVerifyingKey) => ({
  value: 1_000_000n,
  type: ledgerV9.nativeToken().raw,
  owner: ledgerV9.addressFromKey(verifyingKey),
  intentHash: '00'.repeat(32),
  outputNo: 0,
  ctime: new Date(0),
  registeredForDustGeneration: false,
});

/**
 * A dust generation transaction the wallet built for itself: the shape the registration operations act on.
 *
 * @param withRegistration Whether the base already carries a registration — `attachDustRegistration` needs one that
 *   does not, and the signing operations need one that does.
 */
const registrationTransaction = async (
  wallet: ForkWallet,
  ttl: Date,
  verifyingKey: ledgerV9.SignatureVerifyingKey,
  withRegistration: boolean,
): Promise<UnprovenTx> =>
  wallet.dust.createDustGenerationTransaction(
    undefined,
    ttl,
    [nightUtxo(verifyingKey)],
    verifyingKey,
    withRegistration ? await wallet.dust.getAddress() : undefined,
  );

/**
 * Every call that builds, signs or prices a transaction, named as the wallet names it.
 *
 * @remarks
 *   `revertTransaction` and `splitNightUtxosForDustRegistration` are deliberately not among them — see the tests below
 *   for what they do instead.
 *
 *   Every argument is stated in the wallet's own terms: a handle, and a verifying key or signature in the shape the SDK
 *   speaks. What the V1 variant is handed underneath — bare hex, and the previous ledger version's transaction — is the
 *   wallet's business, and that it manages the translation is exactly what these assert.
 */
const transactionBuildingCalls = (wallet: ForkWallet): readonly (readonly [string, () => Promise<unknown>])[] => {
  const ttl = new Date(Date.now() + 3_600_000);
  const verifyingKey = ledgerV9.signatureVerifyingKey(signingKey());
  const signature = ledgerV9.signData(signingKey(), new Uint8Array([1, 2, 3]));
  return [
    [
      'createDustGenerationTransaction',
      () => wallet.dust.createDustGenerationTransaction(undefined, ttl, [], verifyingKey, undefined),
    ],
    [
      'addDustGenerationSignature',
      async () => {
        const base = await registrationTransaction(wallet, ttl, verifyingKey, true);
        return wallet.dust.addDustGenerationSignature(base, signature);
      },
    ],
    [
      'addDustRegistrationSignature',
      async () => {
        const base = await registrationTransaction(wallet, ttl, verifyingKey, true);
        return wallet.dust.addDustRegistrationSignature(base, signature);
      },
    ],
    ['calculateFee', () => wallet.dust.calculateFee([v8Transaction()])],
    ['estimateFee', () => wallet.dust.estimateFee([v8Transaction()])],
    ['balanceTransactions', () => wallet.dust.balanceTransactions([v8Transaction()], ttl)],
  ];
};

/** A wallet on a chain that has not forked, synchronized and holding its dust. */
const syncedV1Wallet: Effect.Effect<ForkWallet, WalletRuntimeError, Scope.Scope> = Effect.gen(function* () {
  const chain = yield* Effect.promise(() => buildDustChain());
  const wallet = yield* walletOnChainAt(chain, v8Version);

  yield* wallet.awaitState((state) => dustCount(state.state) === DUST_EVENT_COUNT);
  expect(yield* wallet.activeTag).toBe(V1Tag);

  return wallet;
});

describe('a dust wallet that asks the chain where it is starting', () => {
  it('starts on the V2 variant of a chain past the boundary, without a hand-over at all', async () =>
    Effect.gen(function* () {
      const chain = yield* Effect.promise(() => buildDustChain());
      const wallet = yield* walletOnChainAt(chain, v9Version, chainReporting(v9Version));

      // The V2 variant does the syncing from the first event, and there is nothing to hand over because
      // nothing was left behind. This is what the hand-over below costs a wallet that could not ask.
      const synced = yield* wallet.awaitState((state) => dustCount(state.state) === DUST_EVENT_COUNT);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(synced.state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(balanceAt(synced.state, chain.syncTime)).toBeGreaterThan(0n);

      expect(yield* wallet.migration).toStrictEqual(Option.none());
    }).pipe(Effect.scoped, Effect.runPromise));

  it('starts on the V1 variant of a chain that has not forked, and stays there', async () =>
    Effect.gen(function* () {
      const chain = yield* Effect.promise(() => buildDustChain());
      const wallet = yield* walletOnChainAt(chain, v8Version, chainReporting(v8Version));

      // The answer sends it to the variant that owns the version, which below the boundary is the one it would have
      // started on anyway. What the probe changes here is nothing at all, which is the claim.
      const synced = yield* wallet.awaitState((state) => dustCount(state.state) === DUST_EVENT_COUNT);
      expect(balanceAt(synced.state, chain.syncTime)).toBeGreaterThan(0n);
      expect(synced.state.protocolVersion).toBeLessThan(forkVersion);

      expect(yield* wallet.activeTag).toBe(V1Tag);
      expect(yield* wallet.migration).toStrictEqual(Option.none());
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('a dust wallet starting on a chain that has already forked', () => {
  it('hands over on the first batch, having applied nothing, and syncs on the V2 variant', async () =>
    Effect.gen(function* () {
      // No probe: the shape of every wallet built without one, and of every application that would rather not have
      // its start depend on reaching an indexer.
      const chain = yield* Effect.promise(() => buildDustChain());
      const wallet = yield* walletOnChainAt(chain, v9Version);

      const migration = yield* wallet.awaitMigration;

      // The chain is past the boundary, so the V1 variant owns none of it: it read the version, applied no
      // event, and handed over with a cursor that has not moved.
      expect(migration.from.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(migration.from.appliedIndex).toBe(0n);
      expect(migration.to.dustCount).toBe(0);
      // Identity crosses, which is what lets the V2 variant read anything addressed to this wallet at all.
      expect(migration.to.dustPublicKey).toBe(ledgerV9.DustSecretKey.fromSeed(dustSeed()).publicKey);

      // And the V2 variant does the syncing, having been started with key material of its own ledger version.
      const synced = yield* wallet.awaitState((state) => dustCount(state.state) === DUST_EVENT_COUNT);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(synced.state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(balanceAt(synced.state, chain.syncTime)).toBeGreaterThan(0n);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('hands over the same way when it asked the chain and got no answer', async () =>
    Effect.gen(function* () {
      const chain = yield* Effect.promise(() => buildDustChain());
      const wallet = yield* walletOnChainAt(chain, v9Version, unreachableChain);

      // A question that cannot be answered leaves the wallet exactly where a wallet that never asked would be — and,
      // above all, leaves it started. An unreachable chain is not a reason to fail to start.
      const migration = yield* wallet.awaitMigration;
      expect(migration.from.appliedIndex).toBe(0n);

      const synced = yield* wallet.awaitState((state) => dustCount(state.state) === DUST_EVENT_COUNT);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(balanceAt(synced.state, chain.syncTime)).toBeGreaterThan(0n);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('a dust wallet starting on a chain that has not forked', () => {
  it('syncs on the V1 variant and stays there', async () =>
    Effect.gen(function* () {
      const chain = yield* Effect.promise(() => buildDustChain());
      const wallet = yield* walletOnChainAt(chain, v8Version);

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
    'addDustGenerationSignature',
    'addDustRegistrationSignature',
    'calculateFee',
    'estimateFee',
    'balanceTransactions',
  ])('answers %s while it is still on ledger-v8, with the ledger version the chain is on', async (operation) =>
    Effect.gen(function* () {
      const wallet = yield* syncedV1Wallet;

      const call = transactionBuildingCalls(wallet).find(([name]) => name === operation)!;
      const answer = yield* Effect.promise(call[1]);

      // It answered rather than refusing. Where the answer is a transaction it is stamped with the version that built
      // it — a ledger-v8 one — so everything that routes on the version afterwards has what it needs; where it is a
      // number (a fee), the answer is the number ledger-v8's own cost model gives.
      if (WalletTransaction.is(answer)) {
        expect(answer.protocolVersion).toBeLessThan(forkVersion);
      } else {
        expect(answer).toBeDefined();
      }
      expect(yield* wallet.activeTag).toBe(V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it('attaches a registration on the V1 variant, which is what raises when there is nowhere to attach it', async () =>
    Effect.gen(function* () {
      // The only intent `attachDustRegistration` can act on is one the *unshielded* wallet built, which this suite has
      // no way to produce — so what is asserted here is the thing the refusal it replaced hid: the call reaches the
      // V1 variant's own transacting and is answered by it. The error is that capability's own, about the state
      // of the intent, and is neither a refusal to transact ledger-v8 nor a version mismatch.
      const wallet = yield* syncedV1Wallet;
      const ttl = new Date(Date.now() + 3_600_000);
      const verifyingKey = ledgerV9.signatureVerifyingKey(signingKey());
      const base = yield* Effect.promise(() => registrationTransaction(wallet, ttl, verifyingKey, true));

      const failure = Option.getOrThrow(
        yield* failureOf(wallet.dust.attachDustRegistration(base, new Date(), verifyingKey, undefined, 0n)),
      );

      expect(failure).not.toBeInstanceOf(ProtocolVersionMismatchError);
      expect(String(failure)).toContain('already has a dust registration attached');
    }).pipe(Effect.scoped, Effect.runPromise));

  it('pays a fee out of the dust it actually holds', async () =>
    Effect.gen(function* () {
      // The refusal these replaced could be satisfied by any wallet at all; this cannot. Balancing selects dust the
      // V1 variant synchronized, with the V1 variant's own key, and prices it against a ledger-v8 block.
      const wallet = yield* syncedV1Wallet;

      const { transaction, blockData } = yield* Effect.promise(() =>
        wallet.dust.balanceTransactions([v8Transaction()], new Date(Date.now() + 3_600_000)),
      );

      expect(transaction.protocolVersion).toBeLessThan(forkVersion);
      expect(blockData.ledgerParameters).toBeInstanceOf(V8LedgerParameters);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('refuses a transaction built on the other side of the boundary, naming both versions', async () =>
    Effect.gen(function* () {
      const wallet = yield* syncedV1Wallet;

      const failure = Option.getOrThrow(yield* failureOf(wallet.dust.calculateFee([v9Transaction()])));

      expect(failure).toBeInstanceOf(ProtocolVersionMismatchError);
      expect(failure).toMatchObject({ authoredFor: forkVersion });
    }).pipe(Effect.scoped, Effect.runPromise));

  it('refuses a signature of a scheme ledger-v8 does not have', async () =>
    Effect.gen(function* () {
      // The one scalar that genuinely changed shape at the fork. An ecdsa signature has no ledger-v8 encoding at all,
      // so it is refused by name rather than lowered into bytes that ledger version would misread.
      const wallet = yield* syncedV1Wallet;

      const failure = Option.getOrThrow(
        yield* failureOf(
          wallet.dust.addDustRegistrationSignature(v8Transaction(), { tag: 'ecdsa', value: '00'.repeat(64) }),
        ),
      );

      expect(failure).toMatchObject({ kind: 'ecdsa' });
    }).pipe(Effect.scoped, Effect.runPromise));

  it('reverts a transaction of the other epoch by doing nothing to its state', async () =>
    Effect.gen(function* () {
      // Reverting releases dust a transaction booked, and a transaction of the other ledger version cannot have
      // booked any of this variant's. So this resolves, changes nothing, and is deliberately not a version mismatch:
      // the facade reverts all three wallets together when a submission fails, and a refusal here would strand that
      // whole path.
      const wallet = yield* syncedV1Wallet;

      yield* Effect.promise(() => wallet.dust.revertTransaction(v9Transaction()));

      const after = yield* wallet.currentState;
      expect(dustCount(after.state)).toBe(DUST_EVENT_COUNT);
      expect(yield* wallet.activeTag).toBe(V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('still splits Night UTxOs for a registration, which needs no proving at all', async () =>
    Effect.gen(function* () {
      // Plain arithmetic over plain data — no ledger object crosses it — so the V1 variant answers it exactly as
      // the ledger-v9 one does. Gating it would break fee estimation on a chain that has not forked yet, for no reason.
      const wallet = yield* syncedV1Wallet;

      const split = yield* Effect.promise(() => wallet.dust.splitNightUtxosForDustRegistration(new Date(), [], true));

      expect(split.guaranteedUtxos).toEqual([]);
      expect(split.fallibleUtxos).toEqual([]);
      expect(yield* wallet.activeTag).toBe(V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise));
});

/**
 * A dust wallet on a chain past the boundary that has shown it nothing.
 *
 * @remarks
 *   The hazard the probe closes, and the reason it is a correctness item rather than an optimization. A wallet learns the
 *   chain's version from the events it observes, so one that has observed none holds the only version it can assume:
 *   the bottom of the timeline. That is not a transient state on a chain whose dust timeline contains nothing addressed
 *   to this wallet — it is where the wallet stays, for as long as it runs. And since transacting works on either side
 *   of the boundary, the wallet does not refuse: it prices and builds with the wrong ledger version, against a chain
 *   that will reject the result.
 *
 *   Modelled by a wire that never emits, which is exactly the observable position of a wallet whose source has nothing to
 *   deliver. What is asserted is the epoch the wallet believes it is in, read through a call that enforces it.
 */
describe('a dust wallet on a chain that has shown it no events', () => {
  const walletOnSilentChain = (chainVersionProbe?: ChainVersionProbe): Effect.Effect<ForkWallet, never, Scope.Scope> =>
    Effect.gen(function* () {
      const wire = yield* Queue.unbounded<readonly TimelineEvent[]>();
      const replayed = yield* Deferred.make<readonly TimelineEvent[]>();

      const wallet = yield* makeForkWallet({
        v8: Stream.fromQueue(wire),
        replayed: Deferred.await(replayed),
        networkId,
        forkVersion,
        seed: dustSeed(),
        dustParameters,
        syncTime: new Date(),
        ...(chainVersionProbe !== undefined ? { chainVersionProbe } : {}),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      return wallet;
    });

  it('believes it is on ledger-v8, and refuses the chain’s own transactions, when it never asked', async () =>
    Effect.gen(function* () {
      const wallet = yield* walletOnSilentChain();

      const failure = Option.getOrThrow(yield* failureOf(wallet.dust.calculateFee([v9Transaction()])));

      // A transaction of the ledger version this chain actually runs, refused by a wallet sitting on the same chain.
      expect(failure).toBeInstanceOf(ProtocolVersionMismatchError);
      expect(yield* wallet.activeTag).toBe(V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('is in the epoch the chain is in, having asked it', async () =>
    Effect.gen(function* () {
      const wallet = yield* walletOnSilentChain(chainReporting(v9Version));

      // Same wallet, same silent chain, one question asked: the transaction is now one this wallet can price, and the
      // variant holding it is the one the chain is on.
      expect(yield* failureOf(wallet.dust.calculateFee([v9Transaction()]))).toStrictEqual(Option.none());
      expect(yield* wallet.activeTag).toBe(V2Tag);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('projections fast-sync and the two-variant wallet', () => {
  it('is a ledger-v9 capability the V1 variant does not have and never will', () => {
    // The load-bearing fact behind the finding below, asserted rather than asserted-in-prose: the projections path
    // exists only on the V2 variant. It needs `DustLocalState` APIs no published ledger-v8 has, so this
    // is permanent rather than a gap to be closed — the V1 variant syncs by event replay, full stop.
    expect(V2Sync.makeEventLessSyncService).toBeDefined();
    expect(V2Sync.makeEventLessSyncCapability).toBeDefined();
    expect('makeEventLessSyncService' in V1Sync).toBe(false);
    expect('makeEventLessSyncCapability' in V1Sync).toBe(false);
  });

  it('is still reachable only through a single-variant composition, probe or no probe', async () =>
    Effect.gen(function* () {
      // The finding survives the start probe, which changes where a wallet begins and not what it can sync with. A
      // two-variant wallet has to be able to read a chain below the boundary, and below the boundary there is only the
      // event path — so its V2 variant is composed with the event sync too, and it is on the V1 variant
      // whenever the chain has not forked, was not asked, or did not answer. A wallet that wants projections therefore
      // still composes a *single* V2 variant (`CustomDustWallet` + `makeEventLessSyncService`, as
      // `docs-snippets`' `dust-fast-sync.ts` does).
      const chain = yield* Effect.promise(() => buildDustChain());

      const probed = yield* walletOnChainAt(chain, v9Version, chainReporting(v9Version));
      expect(yield* probed.activeTag).toBe(V2Tag);

      // The same class, the same registration, a chain that has not forked: the events variant, and no way for it to
      // be anything else.
      const belowBoundary = yield* walletOnChainAt(chain, v8Version, chainReporting(v8Version));
      expect(yield* belowBoundary.activeTag).toBe(V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise));
});

/**
 * The escape hatch for a caller that will not part with a seed, put to the test it exists for.
 *
 * @remarks
 *   `startWithKeys` is documented as fork-safe — that is the whole reason it demands both sides rather than the one key
 *   an application holds — and every other proof in this package reaches its fork from a seed. So the claim that the
 *   two dust keys are as good as the seed they would have been derived from is the one thing about this start worth
 *   stating, and it is stated by making it cross: the V1 variant reads the ledger-v8 timeline with the ledger-v8 key,
 *   and the V2 variant re-discovers the same dust from the replay.
 */
describe('a dust wallet built from both ledger versions’ dust keys rather than a seed', () => {
  it('syncs the timeline below the boundary and crosses it, re-discovering the same dust', async () =>
    Effect.gen(function* () {
      const chain = yield* Effect.promise(() => buildDustChain());
      const history = numberedFrom(chain.eventBytes, 1, Number(v8Version));
      const replay = numberedFrom(chain.eventBytes, DUST_EVENT_COUNT + 1, Number(forkVersion));
      const wire = yield* Queue.unbounded<readonly TimelineEvent[]>();
      const replayed = yield* Deferred.make<readonly TimelineEvent[]>();

      const wallet = yield* makeForkWallet({
        v8: Stream.fromQueue(wire),
        replayed: Deferred.await(replayed),
        networkId,
        forkVersion,
        seed: dustSeed(),
        // The one difference from every other start in this file: two key objects, and no seed retained anywhere.
        startFrom: 'keys',
        dustParameters,
        syncTime: chain.syncTime,
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      // Read below the boundary, by the ledger version that framed those events — which is the half a wallet holding
      // only the ledger-v9 key could not do.
      yield* Queue.offer(wire, history);
      const synced = yield* wallet.awaitState((state) => dustCount(state.state) === DUST_EVENT_COUNT);
      expect(yield* wallet.activeTag).toBe(V1Tag);
      const v8Balance = balanceAt(synced.state, chain.syncTime);
      expect(v8Balance).toBeGreaterThan(0n);

      // And across: the boundary event reaches the still-open ledger-v8 subscription, and the replay answers.
      yield* Queue.offer(wire, [replay[0]]);
      yield* Deferred.succeed(replayed, replay);

      const migration = yield* wallet.awaitMigration;
      expect(migration.to.dustCount).toBe(0);

      const crossed = yield* wallet.awaitState(
        (state) => state.version >= forkVersion && dustCount(state.state) === DUST_EVENT_COUNT,
      );
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(balanceAt(crossed.state, chain.syncTime)).toBe(v8Balance);
    }).pipe(Effect.scoped, Effect.runPromise));
});
