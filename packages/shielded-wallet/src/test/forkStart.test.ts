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
 * Where a shielded wallet spanning a protocol boundary starts, and what it cannot do until it has crossed it.
 *
 * @remarks
 *   `forkSimulation.test.ts` drives the crossing itself: a chain that forks under a running wallet. The two starts here
 *   are the other question — a wallet meeting a chain that is already on one side or the other, which is what every
 *   application start actually is.
 *
 *   Where it begins turns on one question: whether it asked the chain. A wallet given a way to ask starts at the variant
 *   that owns the version the chain reports, which on a chain past the boundary from its genesis is the ledger-v9 one
 *   from the first moment — no hand-over, and the right epoch before a single event has arrived. A wallet with no way
 *   to ask, or one whose question went unanswered, begins on the V1 variant, because that is where a wallet with no
 *   history belongs, and hands over on the first batch it sees. Both are specified here: the second is not a fallback
 *   in name only, it is what every offline-first application and every wallet built without a probe does.
 *
 *   What the chain is asked is which version its timeline _starts_ under, not which version it has reached, because what
 *   the answer decides is which ledger version can read the first event a fresh wallet fetches. The two coincide on
 *   every chain here that carries one version from its genesis; the pair of starts in the middle of this file is the
 *   case where they do not, and where the difference is the wallet's money.
 *
 *   All of it asserts the boundary by comparison with `forkVersion` and never by the number itself: which protocol
 *   version a chain reports is a property of the chain, and the real fork's value is not final.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  NetworkId,
  ProtocolVersion,
  ProtocolVersionMismatchError,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk-address-format';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import {
  ForkSimulator,
  type LedgerTranslationError,
  type Simulator,
  V8,
  genesisStrictness,
  immediateBlockProducer,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Cause, Effect, Option, Runtime, type Scope } from 'effect';
import { describe, expect, it } from 'vitest';
import { V1Tag } from '../v1/index.js';
import { V2Tag } from '../v2/index.js';
import { type ForkWallet, makeForkWallet } from './forkHarness.js';
import { type MintedCoin, makePayingV9Chain, mintable, v8Payment, translationStub } from './translationStub.js';
import { awaitingCoinHashes, carried, coinValues, totalValue } from './forkWalletAssertions.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its V2 variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has already forked — deliberately past the boundary rather than exactly at it. */
const v9Version = ProtocolVersion.ProtocolVersion(9n);
/** A chain that has not — a version the V1 variant owns. */
const v8Version = ProtocolVersion.ProtocolVersion(5n);

const forkBlock = 4n;

const seed = Buffer.alloc(32, 42);
const otherSeed = Buffer.alloc(32, 43);

const walletValues = [100n, 200n] as const;
const walletTotal = walletValues.reduce((sum, value) => sum + value, 0n);

const walletRecipient = () => {
  const keys = ledgerV9.ZswapSecretKeys.fromSeed(seed);
  return { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey };
};

const strangerAddress = (): ShieldedAddress => {
  const stranger = ledgerV9.ZswapSecretKeys.fromSeed(otherSeed);
  return new ShieldedAddress(
    ShieldedCoinPublicKey.fromHexString(stranger.coinPublicKey),
    ShieldedEncryptionPublicKey.fromHexString(stranger.encryptionPublicKey),
  );
};

const chainCoins = (): readonly MintedCoin[] =>
  walletValues.map((value) => mintable(ledgerV8.shieldedToken().raw, value, walletRecipient()));

/** A ledger-v8 chain stamped with `version` from its genesis block, paying the wallet one coin per block. */
const chainAt = (version: ProtocolVersion.ProtocolVersion, coins: readonly MintedCoin[]) =>
  Effect.gen(function* () {
    const chain = yield* V8.Simulator.init({
      networkId,
      protocolVersion: version,
      blockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
    });
    yield* Effect.forEach(coins, (coin) => chain.submitTransaction(v8Payment(networkId, coin)), {
      discard: true,
    });
    return chain;
  });

/**
 * The ledger-v9 source: a chain that simply pays the wallet these coins.
 *
 * @remarks
 *   Nothing here crosses a fork — every wallet in this file starts on one side or the other — so its ledger-v9 chain is
 *   an ordinary one, and the only way a wallet reading it comes to hold anything is by being paid on it.
 */
const payingChainFor = (coins: readonly MintedCoin[], chain: V8.Simulator) =>
  Effect.gen(function* () {
    const genesisTime = yield* chain.query((state) => state.currentTime);
    return yield* makePayingV9Chain({
      networkId,
      protocolVersion: v9Version,
      genesisBlockNumber: forkBlock,
      genesisTime,
      blockProducer: immediateBlockProducer(undefined, genesisStrictness),
      coins,
    });
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

/**
 * Every call that builds a transaction, named as the wallet names it.
 *
 * @remarks
 *   `revertTransaction` is deliberately not among them: it builds nothing, so what it does with a transaction of the
 *   other epoch is a different question — see the test below.
 */
const transactionBuildingCalls = (
  wallet: ForkWallet,
): readonly (readonly [string, () => Promise<AnyTx | undefined>])[] => {
  const transfer = { amount: 1n, type: ledgerV8.shieldedToken().raw, receiverAddress: strangerAddress() };
  return [
    ['balanceTransaction', () => wallet.shielded.balanceTransaction(v8Transaction())],
    ['transferTransaction', () => wallet.shielded.transferTransaction([transfer])],
    ['initSwap', () => wallet.shielded.initSwap({ [ledgerV8.shieldedToken().raw]: 1n }, [transfer])],
  ];
};

/** A transaction of the ledger-v8, sealed as an application would seal one it built for itself. */
const v8Transaction = (): AnyTx =>
  WalletTransaction.adopt('Unproven', ledgerV8.Transaction.fromParts(networkId), ProtocolVersion.MinSupportedVersion);

/** A transaction of the ledger-v9, sealed at the version the V2 variant answers for. */
const v9Transaction = (): AnyTx =>
  WalletTransaction.adopt('Unproven', ledgerV9.Transaction.fromParts(networkId), forkVersion);

/**
 * A probe answering `version`.
 *
 * @remarks
 *   What a real probe answers is the version the chain's timeline _starts_ under, because that is the one that decides
 *   which ledger version can read the first event a fresh wallet fetches. On the chains above, which carry a single
 *   version from genesis, that is the same number as the tip's; the pair of starts below is where the two differ, and
 *   each of those reads its answer off the chain rather than naming one.
 */
const chainReporting =
  (version: ProtocolVersion.ProtocolVersion): ChainVersionProbe =>
  () =>
    Promise.resolve(version);

/** The version a chain's timeline starts under: what its first block was reported as, which is what a probe answers. */
const timelineStartVersion = (chain: V8.Simulator): Effect.Effect<ProtocolVersion.ProtocolVersion> =>
  chain.query((state) => state.blocks[0].protocolVersion);

/** The version a chain has reached — a true statement about the chain, and the wrong one to start a fresh wallet on. */
const tipVersion = (chain: Simulator): Effect.Effect<ProtocolVersion.ProtocolVersion> =>
  chain.query((state) => state.protocolVersion);

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
 * A wallet on a chain that has not forked, synchronized and holding its coins.
 *
 * @remarks
 *   Synchronized before anything is asked of it so that a refusal below is a refusal to transact at all, rather than a
 *   wallet that has nothing to transact with. Scoped: the caller's scope stops it.
 */
const syncedV1Wallet: Effect.Effect<ForkWallet, LedgerOps.LedgerError | WalletRuntimeError, Scope.Scope> = Effect.gen(
  function* () {
    const coins = chainCoins();
    const chain = yield* chainAt(v8Version, coins);
    const v9 = yield* payingChainFor(coins, chain);

    const wallet = yield* makeForkWallet({
      v8: chain,
      v9: Effect.succeed(v9),
      networkId,
      forkVersion,
      seed,
    });
    yield* Effect.addFinalizer(() => wallet.stop);
    yield* wallet.start;

    yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
    expect(yield* wallet.activeTag).toBe(V1Tag);

    return wallet;
  },
);

describe('a shielded wallet that asks the chain where it is starting', () => {
  it('starts on the V2 variant of a chain past the boundary, without a hand-over at all', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const chain = yield* chainAt(v9Version, coins);
      const v9 = yield* payingChainFor(coins, chain);

      const wallet = yield* makeForkWallet({
        v8: chain,
        v9: Effect.succeed(v9),
        networkId,
        forkVersion,
        seed,
        chainVersionProbe: chainReporting(v9Version),
      });
      yield* Effect.addFinalizer(() => wallet.stop);

      // Before sync has been started, before any event exists to learn from: the variant is already the ledger-v9 one.
      // The V1 variant is not where this wallet began and then left — it never ran.
      expect(yield* wallet.activeTag).toBe(V2Tag);

      yield* wallet.start;

      const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(coinValues(synced.state)).toEqual([...walletValues]);
      expect(synced.version).toBeGreaterThanOrEqual(forkVersion);

      // Nothing was migrated, because nothing was left behind. This is the whole point: the hand-over below is a cost
      // paid only by a wallet that could not ask.
      expect(yield* wallet.migration).toStrictEqual(Option.none());
      expect(yield* wallet.activeTag).toBe(V2Tag);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('starts on the V1 variant of a chain that has not forked, and stays there', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const chain = yield* chainAt(v8Version, coins);
      const v9 = yield* payingChainFor(coins, chain);

      const wallet = yield* makeForkWallet({
        v8: chain,
        v9: Effect.succeed(v9),
        networkId,
        forkVersion,
        seed,
        chainVersionProbe: chainReporting(v8Version),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      // The answer sends it to the variant that owns the version, which below the boundary is the one it would have
      // started on anyway. What the probe changes here is nothing at all, which is the claim.
      const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(coinValues(synced.state)).toEqual([...walletValues]);
      expect(synced.state.protocolVersion).toBeLessThan(forkVersion);

      expect(yield* wallet.activeTag).toBe(V1Tag);
      expect(yield* wallet.migration).toStrictEqual(Option.none());
    }).pipe(Effect.scoped, Effect.runPromise));
});

/**
 * A fresh wallet meeting a chain that forked after it was paid — the shape the 2026-08-28 drill broke on.
 *
 * @remarks
 *   Every start above meets a chain carrying one protocol version from its genesis, where the version the timeline starts
 *   under and the version the chain has reached are the same number and nothing turns on the difference. This is the
 *   case where they differ: the wallet's coins were paid before the boundary, in bytes only ledger-v8 can read, and the
 *   chain has since crossed it. A fresh wallet has read none of that history, so the variant it needs is the one that
 *   can read the _first_ event it will fetch — which is a fact about the bottom of the timeline, not about the tip.
 *
 *   Nothing on the other side re-announces those coins: the fork carried the commitment tree across in place (see
 *   `translationStub.ts`), and the ledger-v9 chain here contains no transaction at all. So a wallet that starts on the
 *   wrong side of the boundary does not merely start late — it never comes to hold anything, which is exactly what the
 *   drill saw. Both answers are put to the same chain below, and read off that chain rather than named.
 */
describe('a fresh shielded wallet on a chain that forked after paying it', () => {
  /** The chain: this wallet's coins in its ledger-v8 history, its tip past the boundary, and nothing said since. */
  const chainForkedAfterPaying = (
    coins: readonly MintedCoin[],
  ): Effect.Effect<
    Readonly<{ v8: V8.Simulator; v9: Simulator }>,
    LedgerOps.LedgerError | LedgerTranslationError,
    Scope.Scope
  > =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({
        networkId,
        forkBlock,
        forkVersion,
        v8Version: v8Version,
        v8BlockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
        v9BlockProducer: immediateBlockProducer(undefined, genesisStrictness),
        translator: translationStub({ networkId, coins }),
      });
      yield* Effect.forEach(coins, (coin) => fork.v8.submitTransaction(v8Payment(networkId, coin)), {
        discard: true,
      });
      const v9 = yield* fork.advanceToFork();
      return { v8: fork.v8, v9 };
    });

  it('starts where its unread history starts, and crosses carrying what it read there', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const { v8, v9 } = yield* chainForkedAfterPaying(coins);

      const wallet = yield* makeForkWallet({
        v8,
        v9: Effect.succeed(v9),
        networkId,
        forkVersion,
        seed,
        chainVersionProbe: chainReporting(yield* timelineStartVersion(v8)),
      });
      yield* Effect.addFinalizer(() => wallet.stop);

      // Below the boundary although the chain is past it, because that is where the history this wallet has not read
      // begins — and handing those ledger-v8 bytes to ledger-v9 is handing it bytes it cannot read.
      expect(yield* wallet.activeTag).toBe(V1Tag);

      yield* wallet.start;

      // It read its coins on the side that can read them. The crossing is made of what the V1 variant held, so
      // a wallet that had found nothing there would cross with nothing — and here the migrated state holds the coins
      // themselves, not a promise of them.
      const migration = yield* wallet.awaitMigration;
      expect(migration.to.coinCount).toBe(walletValues.length);
      expect(migration.from.appliedIndex).toBe(forkBlock);

      // And it arrives holding them. The ledger-v9 chain announced no coin — it contains no transaction at all — so
      // everything this wallet has here it brought across.
      // The byte-crossed state holds its full value at the instant of migration; the coin hashes resolve on the
      // first keyed update after it. Settled means both.
      const crossed = yield* wallet.awaitState(
        (state) =>
          state.version >= forkVersion && totalValue(state.state) === walletTotal && !awaitingCoinHashes(state.state),
      );
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(coinValues(crossed.state)).toEqual([...walletValues]);
      expect(yield* v9.query((state) => state.blocks.flatMap((block) => block.transactions))).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('is left empty by an answer that names the version the chain has reached', async () =>
    Effect.gen(function* () {
      // The cost of the other answer, kept as a permanent negative: the same chain, the same wallet, and a probe that
      // reports the tip. The wallet starts above the boundary, where its own history is unreadable and nothing is
      // re-announced, and there is no path back down — the runtime hands over forwards only.
      const coins = chainCoins();
      const { v8, v9 } = yield* chainForkedAfterPaying(coins);

      const wallet = yield* makeForkWallet({
        v8,
        v9: Effect.succeed(v9),
        networkId,
        forkVersion,
        seed,
        chainVersionProbe: chainReporting(yield* tipVersion(v9)),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      expect(yield* wallet.activeTag).toBe(V2Tag);

      yield* wallet.start;

      // It reads the ledger-v9 chain to its end and is still empty: its coins are behind it, on a side it never
      // stood on. (In the drill this also produced an endless deserialize failure, which needs a source serving
      // ledger-v8 bytes to a V2 variant — the two chains here each serve their own.)
      const read = yield* wallet.awaitState((state) => state.state.progress.appliedIndex > forkBlock);
      expect(totalValue(read.state)).toBe(0n);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(yield* wallet.migration).toStrictEqual(Option.none());
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('a shielded wallet starting on a chain that has already forked', () => {
  it('hands over on the first batch, having applied nothing, and syncs on the V2 variant', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const chain = yield* chainAt(v9Version, coins);
      const v9 = yield* payingChainFor(coins, chain);

      // No probe: the shape of every wallet built without one, and of every application that would rather not have
      // its start depend on reaching an indexer.
      const wallet = yield* makeForkWallet({
        v8: chain,
        v9: Effect.succeed(v9),
        networkId,
        forkVersion,
        seed,
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      const migration = yield* wallet.awaitMigration;

      // The chain is past the boundary, so the V1 variant owns none of it: it read the version, applied no
      // block, and handed over with a cursor that has not moved.
      expect(migration.from.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(migration.from.appliedIndex).toBe(0n);
      expect(migration.to.coinCount).toBe(0);
      // Identity crosses, which is what lets the V2 variant decrypt anything at all.
      expect(migration.to.coinPublicKey).toBe(ledgerV9.ZswapSecretKeys.fromSeed(seed).coinPublicKey);

      // And the V2 variant does the syncing, having been started with key material of its own ledger version.
      const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(synced.version).toBeGreaterThanOrEqual(forkVersion);
      expect(coinValues(synced.state)).toEqual([...walletValues]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('hands over the same way when it asked the chain and got no answer', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const chain = yield* chainAt(v9Version, coins);
      const v9 = yield* payingChainFor(coins, chain);

      const wallet = yield* makeForkWallet({
        v8: chain,
        v9: Effect.succeed(v9),
        networkId,
        forkVersion,
        seed,
        chainVersionProbe: unreachableChain,
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      // A question that cannot be answered leaves the wallet exactly where a wallet that never asked would be — and,
      // above all, leaves it started. An unreachable chain is not a reason to fail to start.
      const migration = yield* wallet.awaitMigration;
      expect(migration.from.appliedIndex).toBe(0n);

      const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(coinValues(synced.state)).toEqual([...walletValues]);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('a shielded wallet starting on a chain that has not forked', () => {
  it('syncs on the V1 variant and stays there', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const chain = yield* chainAt(v8Version, coins);
      // Never reached: a source the V2 variant would consume if it ever ran.
      const v9 = yield* payingChainFor(coins, chain);

      const wallet = yield* makeForkWallet({
        v8: chain,
        v9: Effect.succeed(v9),
        networkId,
        forkVersion,
        seed,
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      // Everything the chain has, read by the ledger version that produced it — from a seed, which is the only key
      // material that answers for a variant the wallet's own API does not speak.
      const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(coinValues(synced.state)).toEqual([...walletValues]);
      expect(synced.state.protocolVersion).toBeLessThan(forkVersion);

      expect(yield* wallet.activeTag).toBe(V1Tag);
      expect(yield* wallet.migration).toStrictEqual(Option.none());
    }).pipe(Effect.scoped, Effect.runPromise));

  it.each(['balanceTransaction', 'transferTransaction', 'initSwap'])(
    'builds %s while it is still on ledger-v8, stamped with the version that built it',
    async (operation) =>
      Effect.gen(function* () {
        const wallet = yield* syncedV1Wallet;

        const call = transactionBuildingCalls(wallet).find(([name]) => name === operation)!;
        const built = yield* Effect.promise(call[1]);

        // It answered rather than refusing, and whatever it produced is stamped with the ledger version the chain is
        // actually on — so everything that routes on the version afterwards (which prover, which validator) has the
        // answer it needs. `balanceTransaction` alone may legitimately produce nothing: a transaction that needs no
        // shielded coins needs no shielded balancing.
        if (built !== undefined) {
          expect(WalletTransaction.is(built)).toBe(true);
          expect(built.protocolVersion).toBeLessThan(forkVersion);
        }
        // Still ledger-v8: building a transaction is not what moves a wallet across the boundary.
        expect(yield* wallet.activeTag).toBe(V1Tag);
      }).pipe(Effect.scoped, Effect.runPromise),
  );

  it('spends what it holds, so a ledger-v8 transfer is a real one', async () =>
    Effect.gen(function* () {
      // The refusal these replaced could be satisfied by any wallet at all; this cannot. The transfer is built from
      // the coins the V1 variant synchronized, by the ledger-v8, and carries them.
      const wallet = yield* syncedV1Wallet;

      const transfer = yield* Effect.promise(() =>
        wallet.shielded.transferTransaction([
          { amount: 50n, type: ledgerV8.shieldedToken().raw, receiverAddress: strangerAddress() },
        ]),
      );

      const built = carried<ledgerV8.UnprovenTransaction>(transfer, forkVersion);
      expect(built).toBeInstanceOf(ledgerV8.Transaction);
      expect(built.guaranteedOffer?.inputs.length ?? 0).toBeGreaterThan(0);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('refuses a transaction built on the other side of the boundary, naming both versions', async () =>
    Effect.gen(function* () {
      // The enforcement the stamp exists for. A ledger-v9 transaction's bytes are of a ledger version the ledger-v8
      // variant cannot read, so balancing it is not something to attempt and fail at — it is refused by name.
      const wallet = yield* syncedV1Wallet;

      const failure = Option.getOrThrow(yield* failureOf(wallet.shielded.balanceTransaction(v9Transaction())));

      expect(failure).toBeInstanceOf(ProtocolVersionMismatchError);
      expect(failure).toMatchObject({ authoredFor: forkVersion });
    }).pipe(Effect.scoped, Effect.runPromise));

  it('reverts a transaction of the other epoch by doing nothing to its state', async () =>
    Effect.gen(function* () {
      // Reverting releases coins a transaction booked, and a transaction of the other ledger version cannot have
      // booked any of this variant's. So this resolves, changes nothing, and is deliberately not a version mismatch:
      // the facade reverts all three wallets together when a submission fails, and a refusal here would strand that
      // whole path.
      const wallet = yield* syncedV1Wallet;

      yield* Effect.promise(() => wallet.shielded.revertTransaction(v9Transaction()));

      const after = yield* wallet.currentState;
      expect(totalValue(after.state)).toBe(walletTotal);
      expect(yield* wallet.activeTag).toBe(V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise));
});

/**
 * A wallet on a chain past the boundary that has shown it nothing.
 *
 * @remarks
 *   The hazard the probe closes, and the reason it is a correctness item rather than an optimization. A wallet learns the
 *   chain's version from the events it observes, so one that has observed none holds the only version it can assume:
 *   the bottom of the timeline. That is not a transient state on a chain whose shielded timeline contains nothing
 *   addressed to this wallet — it is where the wallet stays, for as long as it runs. And since transacting works on
 *   either side of the boundary, the wallet does not refuse: it builds with the wrong ledger version, against a chain
 *   that will reject the result.
 *
 *   Modelled by not starting synchronization, which is exactly the observable position of a wallet whose source has
 *   nothing to deliver: no event has been applied. What is asserted is the epoch the wallet believes it is in, read
 *   through the one call that enforces it.
 */
describe('a shielded wallet on a chain that has shown it no events', () => {
  const walletOnSilentChain = (chainVersionProbe?: ChainVersionProbe) =>
    Effect.gen(function* () {
      const chain = yield* chainAt(v9Version, []);
      const v9 = yield* payingChainFor([], chain);

      const wallet = yield* makeForkWallet({
        v8: chain,
        v9: Effect.succeed(v9),
        networkId,
        forkVersion,
        seed,
        ...(chainVersionProbe !== undefined ? { chainVersionProbe } : {}),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      return wallet;
    });

  it('believes it is on ledger-v8, and refuses the chain’s own transactions, when it never asked', async () =>
    Effect.gen(function* () {
      const wallet = yield* walletOnSilentChain();

      const failure = Option.getOrThrow(yield* failureOf(wallet.shielded.balanceTransaction(v9Transaction())));

      // A transaction of the ledger version this chain actually runs, refused by a wallet sitting on the same chain.
      expect(failure).toBeInstanceOf(ProtocolVersionMismatchError);
      expect(yield* wallet.activeTag).toBe(V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('is in the epoch the chain is in, having asked it', async () =>
    Effect.gen(function* () {
      const wallet = yield* walletOnSilentChain(chainReporting(v9Version));

      // Same wallet, same silent chain, one question asked: the transaction is now one this wallet can read, and the
      // variant holding it is the one the chain is on.
      expect(yield* failureOf(wallet.shielded.balanceTransaction(v9Transaction()))).toStrictEqual(Option.none());
      expect(yield* wallet.activeTag).toBe(V2Tag);
    }).pipe(Effect.scoped, Effect.runPromise));
});

/**
 * The escape hatch for a caller that will not part with a seed, put to the test it exists for.
 *
 * @remarks
 *   `startWithKeys` is documented as fork-safe — that is the whole reason it demands both sides rather than the one key
 *   an application holds — and every other proof in this package reaches its fork from a seed. So the claim that the
 *   two key objects are as good as the seed they would have been derived from is the one thing about this start that is
 *   worth stating, and it is stated by making it cross: the V1 variant reads the ledger-v8 chain with the ledger-v8
 *   key, and what the wallet carries over arrives whole.
 */
describe('a shielded wallet built from both ledger versions’ keys rather than a seed', () => {
  it('syncs the chain below the boundary and crosses it, carrying what it read there', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const fork = yield* ForkSimulator.init({
        networkId,
        forkBlock,
        forkVersion,
        v8Version: v8Version,
        v8BlockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
        v9BlockProducer: immediateBlockProducer(undefined, genesisStrictness),
        translator: translationStub({ networkId, coins }),
      });

      const wallet = yield* makeForkWallet({
        v8: fork.v8,
        v9: fork.awaitV9(),
        networkId,
        forkVersion,
        seed,
        // The one difference from every other start in this file: two key objects, and no seed retained anywhere.
        startFrom: 'keys',
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      // Read below the boundary, by the ledger version that produced those bytes — which is the half a wallet holding
      // only the ledger-v9 key could not do.
      yield* Effect.forEach(coins, (coin) => fork.v8.submitTransaction(v8Payment(networkId, coin)), {
        discard: true,
      });
      const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(yield* wallet.activeTag).toBe(V1Tag);
      expect(coinValues(synced.state)).toEqual([...walletValues]);

      const v9 = yield* fork.advanceToFork();
      const migration = yield* wallet.awaitMigration;
      expect(migration.to.coinCount).toBe(walletValues.length);

      // And it arrives holding them. The ledger-v9 chain contains no transaction at all, so everything the wallet has
      // here it brought across.
      const crossed = yield* wallet.awaitState(
        (state) =>
          state.version >= forkVersion && totalValue(state.state) === walletTotal && !awaitingCoinHashes(state.state),
      );
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(coinValues(crossed.state)).toEqual([...walletValues]);
      expect(yield* v9.query((state) => state.blocks.flatMap((block) => block.transactions))).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));
});
