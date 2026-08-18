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
 * A shielded wallet crossing a hard fork and re-discovering its coins from the replayed timeline.
 *
 * @remarks
 *   Every other test of this machinery specifies one seam. This drives all of them at once: a ledger-v8 chain pays the
 *   wallet, the pre-fork variant syncs it, the chain reaches the boundary height, the wallet hands over to the
 *   ledger-v9 variant with a _fresh_ state, and that variant finds the same coins again by syncing the indexer's replay
 *   — then spends them.
 *
 *   Which is the whole point of the corrected design: nothing about the coins crosses the boundary. The migration is
 *   allowed to carry identity and a place in the timeline, and the coins are re-earned by ordinary synchronization. If
 *   the wallet ends up whole here, it did so through the sync path it uses every day.
 *
 *   **Unit tier, and complete.** Modelling the replay needs no state translation — the pre-fork coins are re-announced as
 *   post-fork transactions, which is what an indexer replay is — so every assertion here is earned without a WASM
 *   artifact. `forkSimulation.integration.test.ts` adds the one claim this tier cannot make: that the tree the wallet
 *   rebuilds from the replay is the tree the ledger team's real v8-to-v9 translation produces.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk-address-format';
import {
  type Simulator,
  V8,
  genesisStrictness,
  immediateBlockProducer,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { type LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Deferred, Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { V1Tag } from '../v1/index.js';
import { V2Tag } from '../v2/index.js';
import { type ReplayedCoin, makeReplayChain, mintable, preForkPayment } from './forkReplay.js';
import { type ForkWallet, makeForkWallet } from './forkWallet.js';
import { ascending, coinIndices, coinValues, totalValue, treeSize } from './forkWalletAssertions.js';

const networkId = NetworkId.NetworkId.Undeployed;

/**
 * The boundary, stated once.
 *
 * `forkVersion` is where the post-fork variant is registered _and_ what the chain activates at `forkBlock` — the same
 * number reaching the runtime through registration and through the timeline, which is the whole point of D5. It is
 * deliberately an arbitrary number: the real fork's protocol version is not final, and nothing here may depend on it.
 */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
const forkBlock = 8n;

/** A version bump the pre-fork variant owns: inside `[MinSupportedVersion, forkVersion)`, so it must not migrate. */
const withinRangeVersion = ProtocolVersion.ProtocolVersion(5n);

const seed = Buffer.alloc(32, 42);
const otherSeed = Buffer.alloc(32, 43);

const preForkProducer = () => V8.immediateBlockProducer(undefined, V8.genesisStrictness);
const replayProducer = () => immediateBlockProducer(undefined, genesisStrictness);

const walletRecipient = () => {
  const keys = v9.ZswapSecretKeys.fromSeed(seed);
  return { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey };
};

const strangerRecipient = () => {
  const keys = v9.ZswapSecretKeys.fromSeed(otherSeed);
  return { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey };
};

const recipientAddress = (): ShieldedAddress => {
  const stranger = strangerRecipient();
  return new ShieldedAddress(
    ShieldedCoinPublicKey.fromHexString(stranger.coinPublicKey),
    ShieldedEncryptionPublicKey.fromHexString(stranger.encryptionPublicKey),
  );
};

const walletValues = [100n, 200n, 300n, 400n] as const;
const walletTotal = walletValues.reduce((sum, value) => sum + value, 0n);
/**
 * Where the wallet's coins sit in the commitment tree.
 *
 * @remarks
 *   Non-contiguous and short of the tip on purpose: a stranger is paid at index 3 and again at 5, so the wallet has to
 *   skip commitments it cannot decrypt while replaying, both in the middle of its own run and after it. A densely
 *   minted wallet would exercise neither.
 */
const walletIndices = [0n, 1n, 2n, 4n];
const treeSizeAtFork = 6n;

/** The pre-fork commitment sequence, sampled once per chain: three to us, a stranger's, ours, a stranger's again. */
const chainCoins = (): readonly ReplayedCoin[] => {
  const tokenType = v8.shieldedToken().raw;
  const us = walletRecipient();
  const them = strangerRecipient();
  return [
    mintable(tokenType, 100n, us),
    mintable(tokenType, 200n, us),
    mintable(tokenType, 300n, us),
    mintable(tokenType, 50n, them),
    mintable(tokenType, 400n, us),
    mintable(tokenType, 50n, them),
  ];
};

/** A ledger-v8 chain that will activate `version` at `forkBlock`, with `coins` already paid out one per block. */
const preForkChain = (coins: readonly ReplayedCoin[], version: ProtocolVersion.ProtocolVersion) =>
  Effect.gen(function* () {
    const chain = yield* V8.Simulator.init({ networkId, blockProducer: preForkProducer() });
    yield* chain.scheduleFork(forkBlock, version);
    yield* Effect.forEach(coins, (coin) => chain.submitTransaction(preForkPayment(networkId, coin)), {
      discard: true,
    });
    return chain;
  });

/** Produces empty blocks until the chain stands at `height`, which is where the scheduled version change bites. */
const driveTo = (chain: V8.Simulator, height: bigint): Effect.Effect<void, LedgerOps.LedgerError> =>
  Effect.gen(function* () {
    const current = yield* chain.query(V8.getCurrentBlockNumber);
    if (current >= height) return;
    yield* chain.produceEmptyBlock();
    yield* driveTo(chain, height);
  });

/**
 * The indexer's replay of `coins`, numbered and clocked as a continuation of `chain`.
 *
 * @remarks
 *   Both continuations matter and for the same reason: the replay is the pre-fork timeline carrying on, not a second one
 *   starting. Its event ids — block numbers here — resume at the boundary height, which is where a migrated wallet's
 *   parked cursor is waiting for them.
 */
const replayOf = (coins: readonly ReplayedCoin[], chain: V8.Simulator) =>
  Effect.gen(function* () {
    const genesisTime = yield* chain.query((state) => state.currentTime);
    return yield* makeReplayChain({
      networkId,
      protocolVersion: forkVersion,
      genesisBlockNumber: forkBlock,
      genesisTime,
      blockProducer: replayProducer(),
      coins,
    });
  });

/** The wallet has handed over and finished reading the replay. */
const rediscovered = (wallet: ForkWallet) =>
  wallet.awaitState((state) => state.version >= forkVersion && totalValue(state.state) === walletTotal);

describe('a shielded wallet crossing a hard fork', () => {
  it('starts the new variant empty and re-discovers its coins from the replayed timeline', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const chain = yield* preForkChain(coins, forkVersion);
      const replayed = yield* Deferred.make<Simulator>();

      const wallet = makeForkWallet({
        preFork: chain,
        replayed: Deferred.await(replayed),
        networkId,
        forkVersion,
        seed,
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      // --- pre-fork: the ledger-v8 variant syncs the ledger-v8 chain --------------------------------------------
      const preFork = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(yield* wallet.activeTag).toBe(V1Tag);
      expect(coinValues(preFork.state)).toEqual([...walletValues]);
      expect(coinIndices(preFork.state)).toEqual(walletIndices);
      expect(treeSize(preFork.state)).toBe(treeSizeAtFork);

      // --- the chain reaches the boundary, and the indexer starts replaying -------------------------------------
      yield* driveTo(chain, forkBlock);
      yield* Deferred.succeed(replayed, yield* replayOf(coins, chain));

      const migration = yield* wallet.awaitMigration;
      expect(yield* wallet.activeTag).toBe(V2Tag);

      // What the pre-fork variant handed over: its identity, the version that triggered the hand-over, and a cursor
      // parked on the boundary height — observed and annotated, deliberately not applied.
      expect(migration.from.coinPublicKey).toBe(v8.ZswapSecretKeys.fromSeed(seed).coinPublicKey);
      expect(migration.from.protocolVersion).toBe(forkVersion);
      expect(migration.from.appliedIndex).toBe(forkBlock);

      // And what it produced: a wallet holding no coins at all — no tree, no coin hashes — because they are about to
      // arrive again as replayed events, and carrying them would double-count what the replay is delivering.
      expect(migration.to.coinCount).toBe(0);
      expect(migration.to.firstFree).toBe(0n);
      expect(migration.to.coinHashCount).toBe(0);
      // **Parked, not rewound.** The one place the two cursor semantics are directly distinguishable: the state the
      // migration produced, before any sync has touched it. The replayed timeline continues the indexer's event ids
      // from where the fork found them, so this wallet resumes on the cursor its predecessor stopped at. A migration
      // that reset to zero fails here — and only here, because a cursor behind the replay still reads all of it.
      expect(migration.to.appliedIndex).toBe(migration.from.appliedIndex);
      expect(migration.to.appliedIndex).toBe(forkBlock);
      // Identity is the one thing that does cross: without these keys the replay decrypts into nothing.
      expect(migration.to.coinPublicKey).toBe(v9.ZswapSecretKeys.fromSeed(seed).coinPublicKey);
      expect(migration.to.encryptionPublicKey).toBe(v9.ZswapSecretKeys.fromSeed(seed).encryptionPublicKey);
      expect(migration.to.networkId).toBe(networkId);
      // Kept so the restarted variant sits inside its own activation range instead of signalling backwards at once.
      expect(migration.to.protocolVersion).toBe(forkVersion);

      // --- post-fork: the coins are re-discovered, not carried --------------------------------------------------
      const postFork = yield* rediscovered(wallet);
      expect(coinValues(postFork.state)).toEqual([...walletValues]);
      // At the same indices, because the replay re-announces the same commitments in the same order.
      expect(coinIndices(postFork.state)).toEqual(walletIndices);
      // And the whole tree, not just the leaves it owns: the stranger's commitments were replayed and skipped over.
      expect(treeSize(postFork.state)).toBe(treeSizeAtFork);
      // Read onwards from the boundary rather than from the start of anything: the replay opens at the fork height and
      // runs one block per coin, so a wallet that consumed all of it lands that many blocks past where it parked.
      expect(postFork.state.progress.appliedIndex).toBe(forkBlock + BigInt(coins.length) + 1n);

      // --- the re-discovered coins are spendable ----------------------------------------------------------------
      const transferred = 150n;
      const transfer = yield* wallet.onPostForkVariant((variant) =>
        variant.transferTransaction(wallet.keys.postFork, [
          { amount: transferred, type: v9.shieldedToken().raw, receiverAddress: recipientAddress() },
        ]),
      );

      const replayChain = yield* Deferred.await(replayed);
      const block = yield* replayChain.submitTransaction(transfer.eraseProofs());
      // The chain accepting this is the claim: a spend carries a Merkle path built from the wallet's own tree, and is
      // only recognised if that path resolves to a root the chain holds. A tree rebuilt one index off would not.
      expect(block.transactions[0].result.type).toBe('success');

      const afterSpend = yield* wallet.awaitState((state) => state.state.progress.appliedIndex > block.number);
      expect(totalValue(afterSpend.state)).toBe(walletTotal - transferred);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('does not migrate on a version bump that stays inside the running variant range', async () =>
    Effect.gen(function* () {
      // Same chain, same registration, one number different: the timeline activates a version the pre-fork variant
      // still owns. The version is written into state either way — what must not happen is a hand-over.
      const coins = chainCoins();
      const chain = yield* preForkChain(coins, withinRangeVersion);
      const replayed = yield* Deferred.make<Simulator>();

      const wallet = makeForkWallet({
        preFork: chain,
        replayed: Deferred.await(replayed),
        networkId,
        forkVersion,
        seed,
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;
      yield* driveTo(chain, forkBlock);

      const state = yield* wallet.awaitState((current) => current.state.progress.appliedIndex > forkBlock);

      // Seen and annotated on the wallet's own state — the annotation the runtime reads — and, being inside the
      // range, it decided nothing. (Asserted here rather than on `ProtocolState.version`, which the runtime publishes
      // one state emission behind a within-range bump.)
      expect(state.state.protocolVersion).toBe(withinRangeVersion);
      expect(yield* wallet.activeTag).toBe(V1Tag);
      expect(yield* wallet.migration).toStrictEqual(Option.none());
      // The bumped block was applied rather than deferred, so nothing was left behind for a variant that never ran.
      expect(state.state.progress.appliedIndex).toBe(forkBlock + 1n);
      expect(totalValue(state.state)).toBe(walletTotal);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('migrates a wallet whose first sync already contains the fork', async () =>
    Effect.gen(function* () {
      // Scenario 2: a wallet started from seed after the fork has happened. Its pre-fork variant meets the whole
      // pre-fork history in a single batch, so the boundary is split *within* one update rather than across two.
      const coins = chainCoins();
      const chain = yield* preForkChain(coins, forkVersion);
      yield* driveTo(chain, forkBlock);
      const replayChain = yield* replayOf(coins, chain);

      const wallet = makeForkWallet({
        preFork: chain,
        replayed: Effect.succeed(replayChain),
        networkId,
        forkVersion,
        seed,
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      const migration = yield* wallet.awaitMigration;
      expect(migration.from.appliedIndex).toBe(forkBlock);
      expect(migration.to.coinCount).toBe(0);
      // Reached in one batch rather than two, and the cursor still parks on the boundary: where the split happened
      // does not change what the next variant inherits.
      expect(migration.to.appliedIndex).toBe(forkBlock);

      // The end state is the same as the live transition reaches, which is the point: how the timeline was delivered
      // is not supposed to change what the wallet ends up holding.
      const postFork = yield* rediscovered(wallet);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(coinValues(postFork.state).toSorted(ascending)).toEqual([...walletValues]);
      expect(coinIndices(postFork.state)).toEqual(walletIndices);
      expect(treeSize(postFork.state)).toBe(treeSizeAtFork);
      expect(postFork.state.progress.appliedIndex).toBe(forkBlock + BigInt(coins.length) + 1n);
    }).pipe(Effect.scoped, Effect.runPromise));
});
