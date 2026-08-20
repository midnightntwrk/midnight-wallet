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
 *   A wallet always begins on the pre-fork variant, because that is the variant a wallet with no history belongs to. On a
 *   chain that has already forked it therefore hands over immediately, having applied nothing: one migration per start,
 *   paid on chains that are entirely past the boundary. That cost is accepted rather than hidden — removing it means
 *   asking the chain for its version before choosing a variant, which is a separate piece of work.
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
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk-address-format';
import { V8, genesisStrictness, immediateBlockProducer } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Cause, Effect, Option, Runtime, type Scope } from 'effect';
import { describe, expect, it } from 'vitest';
import { V1Tag } from '../v1/index.js';
import { V2Tag } from '../v2/index.js';
import { type ForkWallet, makeForkWallet } from './forkHarness.js';
import { type ReplayedCoin, makeReplayChain, mintable, preForkPayment } from './forkReplay.js';
import { carried, coinValues, totalValue } from './forkWalletAssertions.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its post-fork variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has already forked — deliberately past the boundary rather than exactly at it. */
const afterFork = ProtocolVersion.ProtocolVersion(9n);
/** A chain that has not — a version the pre-fork variant owns. */
const beforeFork = ProtocolVersion.ProtocolVersion(5n);

const forkBlock = 4n;

const seed = Buffer.alloc(32, 42);
const otherSeed = Buffer.alloc(32, 43);

const walletValues = [100n, 200n] as const;
const walletTotal = walletValues.reduce((sum, value) => sum + value, 0n);

const walletRecipient = () => {
  const keys = v9.ZswapSecretKeys.fromSeed(seed);
  return { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey };
};

const strangerAddress = (): ShieldedAddress => {
  const stranger = v9.ZswapSecretKeys.fromSeed(otherSeed);
  return new ShieldedAddress(
    ShieldedCoinPublicKey.fromHexString(stranger.coinPublicKey),
    ShieldedEncryptionPublicKey.fromHexString(stranger.encryptionPublicKey),
  );
};

const chainCoins = (): readonly ReplayedCoin[] =>
  walletValues.map((value) => mintable(v8.shieldedToken().raw, value, walletRecipient()));

/** A ledger-v8 chain stamped with `version` from its genesis block, paying the wallet one coin per block. */
const chainAt = (version: ProtocolVersion.ProtocolVersion, coins: readonly ReplayedCoin[]) =>
  Effect.gen(function* () {
    const chain = yield* V8.Simulator.init({
      networkId,
      protocolVersion: version,
      blockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
    });
    yield* Effect.forEach(coins, (coin) => chain.submitTransaction(preForkPayment(networkId, coin)), {
      discard: true,
    });
    return chain;
  });

/** The post-fork source: the same coins, re-announced by the post-fork ledger version. */
const replayOf = (coins: readonly ReplayedCoin[], chain: V8.Simulator) =>
  Effect.gen(function* () {
    const genesisTime = yield* chain.query((state) => state.currentTime);
    return yield* makeReplayChain({
      networkId,
      protocolVersion: afterFork,
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
  const transfer = { amount: 1n, type: v8.shieldedToken().raw, receiverAddress: strangerAddress() };
  return [
    ['balanceTransaction', () => wallet.shielded.balanceTransaction(preForkTransaction())],
    ['transferTransaction', () => wallet.shielded.transferTransaction([transfer])],
    ['initSwap', () => wallet.shielded.initSwap({ [v8.shieldedToken().raw]: 1n }, [transfer])],
  ];
};

/** A transaction of the pre-fork ledger version, sealed as an application would seal one it built for itself. */
const preForkTransaction = (): AnyTx =>
  WalletTransaction.adopt('Unproven', v8.Transaction.fromParts(networkId), ProtocolVersion.MinSupportedVersion);

/** A transaction of the post-fork ledger version, sealed at the version the post-fork variant answers for. */
const postForkTransaction = (): AnyTx =>
  WalletTransaction.adopt('Unproven', v9.Transaction.fromParts(networkId), forkVersion);

/**
 * A wallet on a chain that has not forked, synchronized and holding its coins.
 *
 * @remarks
 *   Synchronized before anything is asked of it so that a refusal below is a refusal to transact at all, rather than a
 *   wallet that has nothing to transact with. Scoped: the caller's scope stops it.
 */
const syncedPreForkWallet: Effect.Effect<ForkWallet, LedgerOps.LedgerError | WalletRuntimeError, Scope.Scope> =
  Effect.gen(function* () {
    const coins = chainCoins();
    const chain = yield* chainAt(beforeFork, coins);
    const replayed = yield* replayOf(coins, chain);

    const wallet = makeForkWallet({ preFork: chain, replayed: Effect.succeed(replayed), networkId, forkVersion, seed });
    yield* Effect.addFinalizer(() => wallet.stop);
    yield* wallet.start;

    yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
    expect(yield* wallet.activeTag).toBe(V1Tag);

    return wallet;
  });

describe('a shielded wallet starting on a chain that has already forked', () => {
  it('hands over on the first batch, having applied nothing, and syncs on the post-fork variant', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const chain = yield* chainAt(afterFork, coins);
      const replayed = yield* replayOf(coins, chain);

      const wallet = makeForkWallet({
        preFork: chain,
        replayed: Effect.succeed(replayed),
        networkId,
        forkVersion,
        seed,
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      const migration = yield* wallet.awaitMigration;

      // The chain is past the boundary, so the pre-fork variant owns none of it: it read the version, applied no
      // block, and handed over with a cursor that has not moved.
      expect(migration.from.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(migration.from.appliedIndex).toBe(0n);
      expect(migration.to.coinCount).toBe(0);
      // Identity crosses, which is what lets the post-fork variant decrypt anything at all.
      expect(migration.to.coinPublicKey).toBe(v9.ZswapSecretKeys.fromSeed(seed).coinPublicKey);

      // And the post-fork variant does the syncing, having been started with key material of its own ledger version.
      const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(synced.version).toBeGreaterThanOrEqual(forkVersion);
      expect(coinValues(synced.state)).toEqual([...walletValues]);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('a shielded wallet starting on a chain that has not forked', () => {
  it('syncs on the pre-fork variant and stays there', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const chain = yield* chainAt(beforeFork, coins);
      // The replay is never reached: a source the post-fork variant would consume if it ever ran.
      const replayed = yield* replayOf(coins, chain);

      const wallet = makeForkWallet({
        preFork: chain,
        replayed: Effect.succeed(replayed),
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
    'builds %s while it is still pre-fork, stamped with the version that built it',
    async (operation) =>
      Effect.gen(function* () {
        const wallet = yield* syncedPreForkWallet;

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
        // Still pre-fork: building a transaction is not what moves a wallet across the boundary.
        expect(yield* wallet.activeTag).toBe(V1Tag);
      }).pipe(Effect.scoped, Effect.runPromise),
  );

  it('spends what it holds, so a pre-fork transfer is a real one', async () =>
    Effect.gen(function* () {
      // The refusal these replaced could be satisfied by any wallet at all; this cannot. The transfer is built from
      // the coins the pre-fork variant synchronized, by the pre-fork ledger version, and carries them.
      const wallet = yield* syncedPreForkWallet;

      const transfer = yield* Effect.promise(() =>
        wallet.shielded.transferTransaction([
          { amount: 50n, type: v8.shieldedToken().raw, receiverAddress: strangerAddress() },
        ]),
      );

      const built = carried<v8.UnprovenTransaction>(transfer, forkVersion);
      expect(built).toBeInstanceOf(v8.Transaction);
      expect(built.guaranteedOffer?.inputs.length ?? 0).toBeGreaterThan(0);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('refuses a transaction built on the other side of the boundary, naming both versions', async () =>
    Effect.gen(function* () {
      // The enforcement the stamp exists for. A post-fork transaction's bytes are of a ledger version the pre-fork
      // variant cannot read, so balancing it is not something to attempt and fail at — it is refused by name.
      const wallet = yield* syncedPreForkWallet;

      const failure = Option.getOrThrow(yield* failureOf(wallet.shielded.balanceTransaction(postForkTransaction())));

      expect(failure).toBeInstanceOf(ProtocolVersionMismatchError);
      expect(failure).toMatchObject({ authoredFor: forkVersion });
    }).pipe(Effect.scoped, Effect.runPromise));

  it('reverts a transaction of the other epoch by doing nothing to its state', async () =>
    Effect.gen(function* () {
      // Reverting releases coins a transaction booked, and a transaction of the other ledger version cannot have
      // booked any of this variant's. So this resolves, changes nothing, and is deliberately not a version mismatch:
      // the facade reverts all three wallets together when a submission fails, and a refusal here would strand that
      // whole path.
      const wallet = yield* syncedPreForkWallet;

      yield* Effect.promise(() => wallet.shielded.revertTransaction(postForkTransaction()));

      const after = yield* wallet.currentState;
      expect(totalValue(after.state)).toBe(walletTotal);
      expect(yield* wallet.activeTag).toBe(V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise));
});
