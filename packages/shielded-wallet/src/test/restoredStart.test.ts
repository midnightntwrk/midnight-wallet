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
 * Starting a wallet that was restored from a snapshot, and what that start has to be able to answer for.
 *
 * @remarks
 *   `forkRestore.test.ts` says which variant a snapshot lands on. This is the question that follows it: a restored wallet
 *   holds no key material at all — snapshots deliberately contain none — so it synchronizes nothing until it is started
 *   again, and what it can be started _with_ is decided by the variant the snapshot put it on.
 *
 *   A snapshot written below the boundary restores onto the V1 variant, whose synchronization needs the ledger-v8 ledger
 *   version's keys. The ledger-v9 key objects `start` takes are the ones this wallet's public API speaks, and they are
 *   the wrong runtime's for that variant — so the two starts that answer for _both_ sides are the instance's
 *   `startWithSeed` and `startWithKeys`, and they are what a wallet restored below the boundary is started with. Doing
 *   so is the whole of the fix: the wallet finishes the ledger-v8 stretch it had not read and crosses the fork on its
 *   own, carrying the state the caller restored it for.
 *
 *   The refusal is kept as a permanent negative beside them. A single ledger-v9 key cannot serve a V1 variant and must
 *   not appear to: the wallet says so by name, and names the two instance starts that would have worked.
 *
 *   The last case is the one that already worked and must go on working: a snapshot written at or past the boundary
 *   restores onto the V2 variant, whose ledger version is the one `start` speaks, so a single key is all it needs.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import {
  ForkSimulator,
  V8,
  genesisStrictness,
  immediateBlockProducer,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { StartMaterial } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { Cause, Effect, Option, Runtime, type Scope, Stream, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import { peekProtocolVersion } from '../Restore.js';
import { V1Tag } from '../v1/index.js';
import { V2Tag } from '../v2/index.js';
import { type ForkWallet, type ForkedState, makeForkWallet } from './forkHarness.js';
import {
  type MintedCoin,
  makePayingV9Chain,
  mintable,
  v9Payment,
  v8Payment,
  translationStub,
} from './translationStub.js';
import { awaitingCoinHashes, coinIndices, coinValues, totalValue, treeSize } from './forkWalletAssertions.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its V2 variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has already forked — past the boundary rather than exactly at it. */
const v9Version = ProtocolVersion.ProtocolVersion(9n);
/** A chain that has not — a version the V1 variant owns. */
const v8Version = ProtocolVersion.ProtocolVersion(5n);

const forkBlock = 4n;

const seed = Buffer.alloc(32, 42);
const otherSeed = Buffer.alloc(32, 43);

const walletValues = [100n, 200n] as const;
const walletTotal = walletValues.reduce((sum, value) => sum + value, 0n);

const walletRecipient = () => {
  const keys = ledgerV8.ZswapSecretKeys.fromSeed(seed);
  return { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey };
};

const strangerRecipient = () => {
  const keys = ledgerV8.ZswapSecretKeys.fromSeed(otherSeed);
  return { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey };
};

/**
 * The ledger-v8 commitment sequence: ours, a stranger's, ours.
 *
 * @remarks
 *   Interleaved so the wallet's own coins are not packed at the bottom of the tree. A crossing that dropped everything it
 *   does not own would still land the wallet's coins at the right indices out of a dense tree, and would prove the easy
 *   half of itself.
 */
const crossingCoins = (): readonly MintedCoin[] => [
  mintable(ledgerV8.shieldedToken().raw, walletValues[0], walletRecipient()),
  mintable(ledgerV8.shieldedToken().raw, 50n, strangerRecipient()),
  mintable(ledgerV8.shieldedToken().raw, walletValues[1], walletRecipient()),
];
const crossingIndices = [0n, 2n];
const treeSizeAtCrossing = 3n;

/** The coins a wallet that never crosses is paid, all of them its own. */
const chainCoins = (): readonly MintedCoin[] =>
  walletValues.map((value) => mintable(ledgerV8.shieldedToken().raw, value, walletRecipient()));

/** A probe answering as a chain on `version` would. */
const chainReporting =
  (version: ProtocolVersion.ProtocolVersion): ChainVersionProbe =>
  () =>
    Promise.resolve(version);

/** The tag of the variant a wallet is running, read the way the harness reads it of the wallet it started. */
const runningTag = (wallet: ForkWallet['shielded']): Effect.Effect<string | symbol> =>
  pipe(
    wallet.runtime.currentVariant,
    Effect.map((current) => current.runningVariant.__polyTag__),
  );

/**
 * The first state a restored wallet publishes that satisfies `predicate`, read off the runtime.
 *
 * @remarks
 *   The runtime's emission rather than the facade's, because what these assert on — the carried tree — is a property of
 *   the variant's own state and not one the facade projects. Monotone predicates only: the stream keeps just the latest
 *   value.
 */
const restoredStates = (wallet: ForkWallet['shielded'], predicate: (state: ForkedState) => boolean) =>
  pipe(
    wallet.runtime.stateChanges,
    Stream.filter(predicate),
    Stream.take(1),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

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

/** A wallet paid the first of the crossing coins, and the snapshot it wrote there — below the boundary. */
type SnapshotBelow = Readonly<{
  fork: ForkSimulator;
  wallet: ForkWallet;
  snapshot: string;
}>;

/**
 * A chain that will fork, a wallet that has read the first payment on it, and the snapshot it wrote.
 *
 * @remarks
 *   Deliberately short of the whole ledger-v8 history: what the restored wallet is asked to do below is finish reading a
 *   stretch of chain the snapshot never saw, which is the ordinary reason an application restores at all. The chain has
 *   not reached the boundary yet, so what the snapshot declares is a ledger-v8 version.
 */
const snapshotBelowTheBoundary = (coins: readonly MintedCoin[]): Effect.Effect<SnapshotBelow, unknown, Scope.Scope> =>
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

    const wallet = yield* makeForkWallet({
      v8: fork.v8,
      v9: fork.awaitV9(),
      networkId,
      forkVersion,
      seed,
    });
    yield* Effect.addFinalizer(() => wallet.stop);
    yield* wallet.start;

    yield* fork.v8.submitTransaction(v8Payment(networkId, coins[0]));
    const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletValues[0]);
    expect(yield* wallet.activeTag).toBe(V1Tag);
    expect(synced.state.protocolVersion).toBeLessThan(forkVersion);

    const snapshot = yield* Effect.promise(() => wallet.shielded.serializeState());
    expect(Option.getOrThrow(peekProtocolVersion(snapshot))).toBeLessThan(forkVersion);

    return { fork, wallet, snapshot };
  });

/**
 * Everything a wallet restored below the boundary and started with material for both sides has to do.
 *
 * @remarks
 *   Both halves matter and neither implies the other. First it finishes the ledger-v8 stretch — proving it was started at
 *   all, on a variant whose ledger version the wallet's own API does not speak. Then it crosses, carrying what the
 *   snapshot held plus what it has just read, onto a chain that re-announces none of it.
 */
const finishesTheV8StretchAndCrosses = (
  restored: ForkWallet['shielded'],
  fork: ForkSimulator,
  coins: readonly MintedCoin[],
) =>
  Effect.gen(function* () {
    expect(yield* runningTag(restored)).toBe(V1Tag);

    // The stretch the snapshot never saw: a stranger's commitment and then the wallet's second coin.
    yield* Effect.forEach(coins.slice(1), (coin) => fork.v8.submitTransaction(v8Payment(networkId, coin)), {
      discard: true,
    });
    const caughtUp = yield* restoredStates(restored, (state) => totalValue(state.state) === walletTotal);
    expect(coinValues(caughtUp.state)).toEqual([...walletValues]);
    expect(caughtUp.state.protocolVersion).toBeLessThan(forkVersion);
    expect(yield* runningTag(restored)).toBe(V1Tag);

    // And across. The ledger-v9 chain contains no transaction at all, so everything the wallet has on the far side it
    // brought with it — half of that read before the snapshot, half after it.
    const v9 = yield* fork.advanceToFork();
    const crossed = yield* restoredStates(
      restored,
      (state) =>
        state.version >= forkVersion && totalValue(state.state) === walletTotal && !awaitingCoinHashes(state.state),
    );
    expect(yield* runningTag(restored)).toBe(V2Tag);
    expect(coinValues(crossed.state)).toEqual([...walletValues]);
    expect(coinIndices(crossed.state)).toEqual(crossingIndices);
    expect(treeSize(crossed.state)).toBe(treeSizeAtCrossing);
    expect(yield* v9.query((state) => state.blocks.flatMap((block) => block.transactions))).toEqual([]);
  });

describe('a shielded wallet restored from a snapshot written below the boundary', () => {
  it('finishes its ledger-v8 history and crosses the fork when started with both versions’ keys', async () =>
    Effect.gen(function* () {
      const coins = crossingCoins();
      const { fork, wallet, snapshot } = yield* snapshotBelowTheBoundary(coins);

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      // What it was restored with, before it is started: the snapshot's coin, and nothing since.
      const asRestored = yield* restoredStates(restored, () => true);
      expect(totalValue(asRestored.state)).toBe(walletValues[0]);

      yield* Effect.promise(() => restored.startWithKeys({ v8: wallet.keys.v8, v9: wallet.keys.v9 }));

      yield* finishesTheV8StretchAndCrosses(restored, fork, coins);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('finishes its ledger-v8 history and crosses the fork when started from the seed', async () =>
    Effect.gen(function* () {
      const coins = crossingCoins();
      const { fork, wallet, snapshot } = yield* snapshotBelowTheBoundary(coins);

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      yield* Effect.promise(() => restored.startWithSeed(seed));

      yield* finishesTheV8StretchAndCrosses(restored, fork, coins);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('refuses a single ledger-v9 key, naming the instance starts that would have worked', async () =>
    Effect.gen(function* () {
      const coins = crossingCoins();
      const { wallet, snapshot } = yield* snapshotBelowTheBoundary(coins);

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      // Refused rather than accepted and left silently unsynchronized: the keys belong to the ledger version this
      // wallet's API speaks, and the variant the snapshot restored onto is the other one. Read as the error it must be,
      // so this fails both when the call resolves and when it rejects with anything else.
      const failure = Option.getOrThrow(
        Option.filter(
          yield* failureOf(restored.start(wallet.keys.v9)),
          (thrown): thrown is StartMaterial.MissingStartAuxError =>
            thrown instanceof StartMaterial.MissingStartAuxError,
        ),
      );
      expect(failure.variantTag).toBe(V1Tag);
      // And the remedies it names are ones this instance has. The class-level starts of the same names build a *fresh*
      // wallet, so pointing a restored wallet at those would be pointing it at discarding the state it was restored for.
      expect(failure.message).toContain('startWithSeed(seed)');
      expect(failure.message).toContain('startWithKeys({ v8, v9 })');
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('a shielded wallet restored from a snapshot written at or past the boundary', () => {
  it('synchronizes from the single ledger-v9 key its own API speaks', async () =>
    Effect.gen(function* () {
      // Unchanged by any of the above, and the reason `start` keeps its shape: on the V2 variant the key a
      // caller holds is the key the running variant needs, so one is enough.
      const coins = chainCoins();
      const chain = yield* V8.Simulator.init({
        networkId,
        protocolVersion: v9Version,
        blockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
      });
      const genesisTime = yield* chain.query((state) => state.currentTime);
      const v9 = yield* makePayingV9Chain({
        networkId,
        protocolVersion: v9Version,
        genesisBlockNumber: forkBlock,
        genesisTime,
        blockProducer: immediateBlockProducer(undefined, genesisStrictness),
        coins,
      });

      const wallet = yield* makeForkWallet({
        v8: chain,
        v9: Effect.succeed(v9),
        networkId,
        forkVersion,
        seed,
        chainVersionProbe: chainReporting(v9Version),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(synced.state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);

      const snapshot = yield* Effect.promise(() => wallet.shielded.serializeState());
      expect(Option.getOrThrow(peekProtocolVersion(snapshot))).toBeGreaterThanOrEqual(forkVersion);

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));
      expect(yield* runningTag(restored)).toBe(V2Tag);

      yield* Effect.promise(() => restored.start(wallet.keys.v9));

      // Started, and demonstrably synchronizing: a payment made after the restore lands on the tree the snapshot
      // carried.
      yield* v9.submitTransaction(
        v9Payment(networkId, mintable(ledgerV9.shieldedToken().raw, 500n, walletRecipient())),
      );
      const advanced = yield* restoredStates(restored, (state) => totalValue(state.state) === walletTotal + 500n);
      expect(coinValues(advanced.state)).toEqual([...walletValues, 500n]);
      expect(yield* runningTag(restored)).toBe(V2Tag);
    }).pipe(Effect.scoped, Effect.runPromise));
});
