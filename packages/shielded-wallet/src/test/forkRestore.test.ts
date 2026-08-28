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
 * Restoring a snapshot into the variant that wrote it, through the wallet class an application holds.
 *
 * @remarks
 *   `restore.test.ts` pins the routing helpers on hand-built envelopes, and the runtime pins `startAtVariant` over
 *   synthetic variants. Neither says that the two meet correctly in a shipped forking wallet, which is the composition
 *   an application actually calls: peek at the snapshot, resolve the variant that owns the version it declares,
 *   deserialize with _that_ variant's deserializer, and start there.
 *
 *   Both epochs are pinned in one file on purpose. A router that always answered with the head variant would pass the
 *   pre-fork half and fail the post-fork one; a router that always answered with the last registration would do the
 *   reverse. Only routing on the snapshot's own declared version passes both.
 *
 *   The third case is the awkward one: a snapshot taken _during_ a crossing. Handing over and re-anchoring are two steps
 *   and an application may serialize between them, so a wallet's coins can be in the snapshot as a carried payload
 *   rather than as a tree. Restoring must bring that payload back and the resumed sync must finish the job — otherwise
 *   a snapshot taken in the wrong second silently costs the wallet everything it owns.
 *
 *   The snapshots are the suite's own: each is written by a running wallet through `serializeState()`, so what is
 *   restored is what this package actually produces rather than a fixture that could drift from it.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { NetworkId, type ProtocolState, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import {
  ForkSimulator,
  type Simulator,
  V8,
  genesisStrictness,
  immediateBlockProducer,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Deferred, Effect, Option, Stream, pipe } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import { peekProtocolVersion } from '../Restore.js';
import { type CoreWallet as PreForkCoreWallet, V1Tag } from '../v1/index.js';
import { type CoreWallet, V2Tag } from '../v2/index.js';
import { type ForkWallet, makeForkWallet } from './forkHarness.js';
import {
  type MintedCoin,
  makePayingPostForkChain,
  mintable,
  postForkPayment,
  preForkPayment,
  translationStub,
} from './translationStub.js';
import { carriedPayload, coinIndices, coinValues, totalValue, treeSize } from './forkWalletAssertions.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its post-fork variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has already forked — past the boundary rather than exactly at it. */
const afterFork = ProtocolVersion.ProtocolVersion(9n);
/** A chain that has not — a version the pre-fork variant owns. */
const beforeFork = ProtocolVersion.ProtocolVersion(5n);

const forkBlock = 4n;

const seed = Buffer.alloc(32, 42);
const otherSeed = Buffer.alloc(32, 43);

const walletValues = [100n, 200n] as const;
const walletTotal = walletValues.reduce((sum, value) => sum + value, 0n);

const walletRecipient = () => {
  const keys = v8.ZswapSecretKeys.fromSeed(seed);
  return { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey };
};

const strangerRecipient = () => {
  const keys = v8.ZswapSecretKeys.fromSeed(otherSeed);
  return { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey };
};

const chainCoins = (): readonly MintedCoin[] =>
  walletValues.map((value) => mintable(v8.shieldedToken().raw, value, walletRecipient()));

/**
 * The same coins with a stranger's between them, for the crossing case.
 *
 * @remarks
 *   Interleaved so re-anchoring has a gap to fast-forward over: with the wallet's own coins packed at the bottom of the
 *   tree the anchor step needs no collapsed update at all, and would prove the easy half of itself.
 */
const crossingCoins = (): readonly MintedCoin[] => [
  mintable(v8.shieldedToken().raw, walletValues[0], walletRecipient()),
  mintable(v8.shieldedToken().raw, 50n, strangerRecipient()),
  mintable(v8.shieldedToken().raw, walletValues[1], walletRecipient()),
];
const crossingIndices = [0n, 2n];
const treeSizeAtCrossing = 3n;

/** A ledger-v8 chain stamped with `version` from its genesis block, paying the wallet one coin per block. */
const chainAt = (version: ProtocolVersion.ProtocolVersion, coins: readonly MintedCoin[]) =>
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

/**
 * The post-fork source for a wallet that never crossed: a chain that simply pays it.
 *
 * @remarks
 *   Both non-crossing cases start on a chain already stamped with the version their probe reports, so nothing about a
 *   fork is being modelled — the wallet has to learn its coins the ordinary way, by being paid on the chain it reads.
 */
const payingChainFor = (coins: readonly MintedCoin[], chain: V8.Simulator) =>
  Effect.gen(function* () {
    const genesisTime = yield* chain.query((state) => state.currentTime);
    return yield* makePayingPostForkChain({
      networkId,
      protocolVersion: afterFork,
      genesisBlockNumber: forkBlock,
      genesisTime,
      blockProducer: immediateBlockProducer(undefined, genesisStrictness),
      coins,
    });
  });

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

/** The first state a restored wallet publishes, which is the one it was restored onto. */
const restoredState = (wallet: ForkWallet['shielded']) => Effect.promise(() => rx.firstValueFrom(wallet.state));

/**
 * The first state a restored wallet publishes that satisfies `predicate`, read off the runtime.
 *
 * @remarks
 *   The runtime's emission rather than the facade's, because what the crossing case asserts on — the carried payload — is
 *   a property of the variant's own state and not one the facade projects. Monotone predicates only: the stream keeps
 *   just the latest value.
 */
const restoredStates = (
  wallet: ForkWallet['shielded'],
  predicate: (state: ProtocolState.ProtocolState<PreForkCoreWallet | CoreWallet>) => boolean,
) =>
  pipe(
    wallet.runtime.stateChanges,
    Stream.filter(predicate),
    Stream.take(1),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

describe('a shielded wallet restoring a snapshot through the class it was started from', () => {
  it('restores a snapshot written below the boundary onto the pre-fork variant, with what it held', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const chain = yield* chainAt(beforeFork, coins);
      const postFork = yield* payingChainFor(coins, chain);

      const wallet = yield* makeForkWallet({
        preFork: chain,
        postFork: Effect.succeed(postFork),
        networkId,
        forkVersion,
        seed,
        chainVersionProbe: chainReporting(beforeFork),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(yield* wallet.activeTag).toBe(V1Tag);

      const snapshot = yield* Effect.promise(() => wallet.shielded.serializeState());
      // The snapshot names the epoch that wrote it, which is the only thing the restore has to go on.
      expect(Option.getOrThrow(peekProtocolVersion(snapshot))).toBe(synced.state.protocolVersion);
      expect(synced.state.protocolVersion).toBeLessThan(forkVersion);

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      expect(yield* runningTag(restored)).toBe(V1Tag);

      const state = yield* restoredState(restored);
      expect(state.protocolVersion).toBeLessThan(forkVersion);
      expect(coinValues(state.state)).toEqual([...walletValues]);
      expect(state.state.publicKeys).toStrictEqual(synced.state.publicKeys);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('restores a snapshot written at or past the boundary onto the post-fork variant, with what it held', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const chain = yield* chainAt(afterFork, coins);
      const postFork = yield* payingChainFor(coins, chain);

      const wallet = yield* makeForkWallet({
        preFork: chain,
        postFork: Effect.succeed(postFork),
        networkId,
        forkVersion,
        seed,
        chainVersionProbe: chainReporting(afterFork),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(yield* wallet.activeTag).toBe(V2Tag);

      const snapshot = yield* Effect.promise(() => wallet.shielded.serializeState());
      expect(Option.getOrThrow(peekProtocolVersion(snapshot))).toBe(synced.state.protocolVersion);
      expect(synced.state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      expect(yield* runningTag(restored)).toBe(V2Tag);

      const state = yield* restoredState(restored);
      expect(state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(coinValues(state.state)).toEqual([...walletValues]);
      expect(state.state.publicKeys).toStrictEqual(synced.state.publicKeys);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('restores a snapshot written mid-crossing, and finishes the anchoring on resume', async () =>
    Effect.gen(function* () {
      const coins = crossingCoins();
      const fork = yield* ForkSimulator.init({
        networkId,
        forkBlock,
        forkVersion,
        preForkBlockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
        postForkBlockProducer: immediateBlockProducer(undefined, genesisStrictness),
        translator: translationStub({ networkId, coins }),
      });
      // Withholding the post-fork source is what makes the crossing observable: the hand-over happens, and the anchor
      // that would immediately follow it cannot, because nothing is answering yet. That is the second a snapshot may
      // land in.
      const answering = yield* Deferred.make<Simulator>();

      const wallet = yield* makeForkWallet({
        preFork: fork.preFork,
        postFork: Deferred.await(answering),
        networkId,
        forkVersion,
        seed,
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      yield* Effect.forEach(coins, (coin) => fork.preFork.submitTransaction(preForkPayment(networkId, coin)), {
        discard: true,
      });
      yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      const postFork = yield* fork.advanceToFork();

      const migration = yield* wallet.awaitMigration;
      expect(migration.to.carriedCoinCount).toBe(walletValues.length);
      expect(migration.to.carriedTreeSize).toBe(treeSizeAtCrossing);

      // Mid-crossing: on the post-fork variant, carrying its coins, holding none.
      const crossing = yield* wallet.awaitState((state) => carriedPayload(state.state) !== undefined);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(coinValues(crossing.state)).toEqual([]);
      expect(treeSize(crossing.state)).toBe(0n);

      const snapshot = yield* Effect.promise(() => wallet.shielded.serializeState());
      expect(Option.getOrThrow(peekProtocolVersion(snapshot))).toBe(forkVersion);

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));
      expect(yield* runningTag(restored)).toBe(V2Tag);

      // The payload survived the round trip. Nothing else could stand in for it: the tree is still empty, so a
      // snapshot that dropped it would restore a wallet with no way left of ever finding these coins.
      const asRestored = yield* restoredStates(restored, () => true);
      expect(carriedPayload(asRestored.state)?.coins.map((coin) => coin.value)).toEqual([...walletValues]);
      expect(carriedPayload(asRestored.state)?.coins.map((coin) => coin.mtIndex)).toEqual(crossingIndices);
      expect(carriedPayload(asRestored.state)?.treeSize).toBe(treeSizeAtCrossing);
      expect(coinValues(asRestored.state)).toEqual([]);

      // The chain answers, and the resumed wallet finishes what the snapshot interrupted.
      yield* Deferred.succeed(answering, postFork);
      yield* Effect.promise(() => restored.start(v9.ZswapSecretKeys.fromSeed(seed)));

      const anchored = yield* restoredStates(restored, (state) => totalValue(state.state) === walletTotal);
      expect(carriedPayload(anchored.state)).toBeUndefined();
      expect(coinValues(anchored.state)).toEqual([...walletValues]);
      expect(coinIndices(anchored.state)).toEqual(crossingIndices);
      expect(treeSize(anchored.state)).toBe(treeSizeAtCrossing);

      // And it goes on: the next commitment the chain produces lands on top of the tree it just rebuilt.
      const block = yield* postFork.submitTransaction(
        postForkPayment(networkId, mintable(v9.shieldedToken().raw, 500n, walletRecipient())),
      );
      const advanced = yield* restoredStates(restored, (state) => totalValue(state.state) === walletTotal + 500n);
      expect(coinIndices(advanced.state)).toEqual([...crossingIndices, treeSizeAtCrossing]);
      expect(advanced.state.progress.appliedIndex).toBe(block.number + 1n);
    }).pipe(Effect.scoped, Effect.runPromise));
});
