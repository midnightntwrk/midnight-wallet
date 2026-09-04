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
 * A shielded wallet crossing a hard fork carrying its own coins.
 *
 * @remarks
 *   Every other test of this machinery specifies one seam. This drives all of them at once: a ledger-v8 chain pays the
 *   wallet, the pre-fork variant syncs it, the chain reaches the boundary height and its ledger is translated into the
 *   post-fork one, the wallet hands over to the ledger-v9 variant — and comes out the other side still holding what it
 *   held, then goes on transacting.
 *
 *   **A fork re-announces nothing.** The chain's state translation carries every commitment across in place: the
 *   post-fork chain opens holding the pre-fork tree, continues inserting at the index that tree reached, and the
 *   indexer numbers its events onwards from where it had got to. Nothing about the pre-fork timeline is served again.
 *   So the wallet's own state has to travel with it — which it does, as bytes: the two ledger majors either side of
 *   this boundary share the `zswap-local-state` codec, so the migration hands the previous version's serialization to
 *   this version's deserializer and the tree arrives whole (`src/v2/test/byteCrossing.test.ts` pins that codec). These
 *   tests are about what that buys, and the post-fork chain here announces nothing precisely so that no assertion below
 *   can be satisfied by re-discovery.
 *
 *   The last test in the file is the failure mode of a migration that does not carry the state, kept deliberately: an
 *   empty tree in front of a chain that is six commitments tall, and the ledger refuses every event it is shown,
 *   forever.
 *
 *   **Unit tier, and complete.** The one thing this tier cannot supply is the real v8-to-v9 translation, which is a WASM
 *   artifact; `translationStub.ts` reconstructs the post-fork ledger instead, and `forkSimulation.integration.test.ts`
 *   makes the same claims against the ledger team's own translation.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion, type SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk-address-format';
import {
  ForkSimulator,
  type Simulator,
  V8,
  genesisStrictness,
  immediateBlockProducer,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { type LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Duration, Effect, Option, Stream, SubscriptionRef, pipe, type Scope } from 'effect';
import { describe, expect, it } from 'vitest';
import { V1Tag } from '../v1/index.js';
import { CoreWallet, PublicKeys, Sync, V2Tag, WalletError } from '../v2/index.js';
import { type CapturedMigration, type ForkWallet, makeForkWallet } from './forkHarness.js';
import {
  type MintedCoin,
  mintable,
  postForkPayment,
  preForkPayment,
  simulatedChainRoot,
  translationStub,
} from './translationStub.js';
import {
  type ExpectedCoin,
  ascending,
  awaitingCoinHashes,
  carried,
  coinIndices,
  coinValues,
  expectedCoins,
  merkleRoot,
  totalValue,
  treeSize,
} from './forkWalletAssertions.js';

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

/** The half-open range the post-fork variant is registered over, as the runtime hands it to that variant. */
const postForkRange = ProtocolVersion.makeRange(forkVersion, ProtocolVersion.MaxSupportedVersion);

const seed = Buffer.alloc(32, 42);
const otherSeed = Buffer.alloc(32, 43);

const preForkProducer = () => V8.immediateBlockProducer(undefined, V8.genesisStrictness);
const postForkProducer = () => immediateBlockProducer(undefined, genesisStrictness);

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

/** The wallet's own address, for a transfer it makes to itself — the plainest way to be owed an output. */
const ownAddress = (): ShieldedAddress => {
  const us = walletRecipient();
  return new ShieldedAddress(
    ShieldedCoinPublicKey.fromHexString(us.coinPublicKey),
    ShieldedEncryptionPublicKey.fromHexString(us.encryptionPublicKey),
  );
};

const walletValues = [100n, 200n, 300n, 400n] as const;
const walletTotal = walletValues.reduce((sum, value) => sum + value, 0n);
/**
 * Where the wallet's coins sit in the commitment tree.
 *
 * @remarks
 *   Non-contiguous and short of the tip on purpose: a stranger is paid at index 3 and again at 5, so the tree that
 *   crosses holds commitments the wallet cannot decrypt, both in the middle of its own run and after it — and reaches
 *   the tip regardless. A densely minted wallet would exercise neither.
 */
const walletIndices = [0n, 1n, 2n, 4n];
const treeSizeAtFork = 6n;

/** The pre-fork commitment sequence, sampled once per chain: three to us, a stranger's, ours, a stranger's again. */
const chainCoins = (): readonly MintedCoin[] => {
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

/** A chain that forks at `forkBlock`, its post-fork side starting from the translation of what the pre-fork side held. */
const forkingChain = (coins: readonly MintedCoin[]): Effect.Effect<ForkSimulator, never, Scope.Scope> =>
  ForkSimulator.init({
    networkId,
    forkBlock,
    forkVersion,
    // Genesis strictness throughout: these payments mint from nothing and the transfer below pays no fees, both of
    // which a fee-enforcing chain would reject for reasons that have nothing to do with the fork.
    preForkBlockProducer: preForkProducer(),
    postForkBlockProducer: postForkProducer(),
    translator: translationStub({ networkId, coins }),
  });

/** Produces empty blocks until the chain stands at `height`, which is where a scheduled version change bites. */
const driveTo = (chain: V8.Simulator, height: bigint): Effect.Effect<void, LedgerOps.LedgerError> =>
  Effect.gen(function* () {
    const current = yield* chain.query(V8.getCurrentBlockNumber);
    if (current >= height) return;
    yield* chain.produceEmptyBlock();
    yield* driveTo(chain, height);
  });

/**
 * The wallet has handed over and read the boundary block — holding everything it held before.
 *
 * @remarks
 *   All three conjuncts are needed and all three are monotone. The crossing itself moves no cursor, so a wallet that has
 *   arrived but not yet applied the empty boundary block already satisfies the balance; waiting for the cursor to pass
 *   the boundary too is what makes the state these tests assert on a single, settled one rather than whichever of the
 *   two the stream happened to publish last.
 */
const settled = (wallet: ForkWallet) =>
  wallet.awaitState(
    (state) =>
      state.version >= forkVersion &&
      totalValue(state.state) === walletTotal &&
      state.state.progress.appliedIndex > forkBlock,
  );

/** A wallet that has synced the pre-fork chain, crossed the boundary, and the chain it now reads. */
type Crossing = Readonly<{
  postFork: Simulator;
  wallet: ForkWallet;
  migration: CapturedMigration;
  /**
   * The root of the tree the wallet held on the pre-fork side — what the crossing has to reproduce exactly.
   *
   * A number rather than the state it came from: the pre-fork state is built on the other ledger's wasm objects, whose
   * lifetime ends with the variant scope the migration closes.
   */
  preForkRoot: bigint | undefined;
  /** The outputs the wallet was still expecting on the pre-fork side — see {@link expectedCoins}. */
  preForkExpected: readonly ExpectedCoin[];
}>;

/**
 * Runs the whole crossing: pay the wallet before the fork, sync it, fork the chain, hand over.
 *
 * @remarks
 *   Stops short of asserting anything about the post-fork side, which is what the individual tests differ on. The
 *   pre-fork state is awaited _before_ the chain is driven to the boundary, so the premise each test builds on — that
 *   the wallet genuinely held these coins on the other side — is established rather than inferred from the end state.
 */
const crossTheFork = (
  coins: readonly MintedCoin[],
  /** Anything the wallet is made to do on the pre-fork side after it has synced and before the boundary arrives. */
  beforeTheBoundary: (wallet: ForkWallet) => Effect.Effect<void, unknown> = () => Effect.void,
): Effect.Effect<Crossing, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const fork = yield* forkingChain(coins);

    const wallet = yield* makeForkWallet({
      preFork: fork.preFork,
      postFork: fork.awaitPostFork(),
      networkId,
      forkVersion,
      seed,
    });
    yield* Effect.addFinalizer(() => wallet.stop);
    yield* wallet.start;

    // --- pre-fork: the ledger-v8 variant syncs the ledger-v8 chain ----------------------------------------------
    yield* Effect.forEach(coins, (coin) => fork.preFork.submitTransaction(preForkPayment(networkId, coin)), {
      discard: true,
    });
    const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
    expect(yield* wallet.activeTag).toBe(V1Tag);
    expect(coinValues(synced.state)).toEqual([...walletValues]);
    expect(coinIndices(synced.state)).toEqual(walletIndices);
    expect(treeSize(synced.state)).toBe(treeSizeAtFork);

    yield* beforeTheBoundary(wallet);
    const preForkState = yield* wallet.currentState;

    // --- the chain reaches the boundary and its ledger is translated ---------------------------------------------
    const postFork = yield* fork.advanceToFork();
    const migration = yield* wallet.awaitMigration;

    return {
      postFork,
      wallet,
      migration,
      preForkRoot: merkleRoot(preForkState.state),
      preForkExpected: expectedCoins(preForkState.state),
    };
  });

describe('a shielded wallet crossing a hard fork', () => {
  it('arrives holding the tree it held, against a chain that announces nothing', async () =>
    Effect.gen(function* () {
      const { postFork, wallet, migration, preForkRoot } = yield* crossTheFork(chainCoins());
      expect(yield* wallet.activeTag).toBe(V2Tag);

      // What the pre-fork variant handed over: its identity, the version that triggered the hand-over, and a cursor
      // parked on the boundary height — observed and annotated, deliberately not applied.
      expect(migration.from.coinPublicKey).toBe(v8.ZswapSecretKeys.fromSeed(seed).coinPublicKey);
      expect(migration.from.protocolVersion).toBe(forkVersion);
      expect(migration.from.appliedIndex).toBe(forkBlock);

      // And what it produced, at the moment it produced it: not a promise of coins but the coins themselves, in a
      // tree as tall as the one left behind. Nothing on the other side of a fork re-announces any of it, so a
      // migration that arrived empty would be arriving without the wallet's money.
      expect(migration.to.coinCount).toBe(walletValues.length);
      expect(migration.to.firstFree).toBe(treeSizeAtFork);
      // The one thing the bytes cannot carry: hashes are derived from the secret keys, which a migration does not
      // hold, so they are declared pending for the first sync update to fill in.
      expect(migration.to.coinHashCount).toBe(0);
      expect(migration.to.coinHashesPending).toBe(true);
      // **Parked, not rewound.** The post-fork timeline continues the indexer's event ids from where the fork found
      // them, so this wallet resumes on the cursor its predecessor stopped at.
      expect(migration.to.appliedIndex).toBe(migration.from.appliedIndex);
      expect(migration.to.appliedIndex).toBe(forkBlock);
      // Identity crosses too: without these keys the crossed coins cannot be recognised as this wallet's at all.
      expect(migration.to.coinPublicKey).toBe(v9.ZswapSecretKeys.fromSeed(seed).coinPublicKey);
      expect(migration.to.encryptionPublicKey).toBe(v9.ZswapSecretKeys.fromSeed(seed).encryptionPublicKey);
      expect(migration.to.networkId).toBe(networkId);
      // Kept so the restarted variant sits inside its own activation range instead of signalling backwards at once.
      expect(migration.to.protocolVersion).toBe(forkVersion);

      // --- post-fork: the same coins, without anything having been served ------------------------------------
      const crossed = yield* settled(wallet);
      expect(coinValues(crossed.state)).toEqual([...walletValues]);
      expect(coinIndices(crossed.state)).toEqual(walletIndices);
      // The whole tree, not just the leaves it owns: the strangers' commitments crossed with it, which is what keeps
      // the wallet's own leaves at the indices the chain has them at.
      expect(treeSize(crossed.state)).toBe(treeSizeAtFork);
      // And the hashes were computed on arrival — one per coin — so the wallet can name what it holds.
      expect(awaitingCoinHashes(crossed.state)).toBe(false);
      // And the tree is the tree it had before the boundary, down to its root — which is also the chain's.
      expect(preForkRoot).toBeDefined();
      expect(merkleRoot(crossed.state)).toBe(preForkRoot);
      expect(yield* postFork.query(simulatedChainRoot)).toBe(preForkRoot);

      // **Carried, not re-discovered.** The post-fork chain has produced exactly one block — its genesis, holding the
      // translated ledger — and it contains no transactions at all. There was nothing here for the wallet to learn
      // its coins from, so it did not learn them: it arrived with them.
      expect(yield* postFork.query((state) => state.blocks.flatMap((block) => block.transactions))).toEqual([]);
      // That empty boundary block is what the wallet did read, and all it read: the version bump, applied.
      expect(crossed.state.progress.appliedIndex).toBe(forkBlock + 1n);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('applies a post-fork payment landing where the pre-fork tree ended', async () =>
    Effect.gen(function* () {
      // The regression the 2026-08-28 drill found on real infrastructure. The chain goes on inserting at the index the
      // pre-fork tree reached, so the first commitment a crossed wallet meets is at `treeSize` — an index an empty
      // local state rejects as a non-linear insertion, and goes on rejecting. Against the tree that crossed with the
      // wallet it is simply the next leaf.
      //
      // Paid without waiting for the wallet to settle first, deliberately: the drill's wallet met a post-fork event
      // while it had done nothing about the fork yet, and that ordering is half the regression. It survives it because
      // the migration is what completes the crossing, not something sync has still to do afterwards.
      const { postFork, wallet } = yield* crossTheFork(chainCoins());

      const late = mintable(v9.shieldedToken().raw, 900n, walletRecipient());
      const block = yield* postFork.submitTransaction(postForkPayment(networkId, late));
      expect(block.transactions[0].result.type).toBe('success');
      expect(yield* postFork.query((state) => state.ledger.zswap.firstFree)).toBe(treeSizeAtFork + 1n);

      const advanced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal + 900n);
      // The new coin sits beside the carried ones rather than replacing them, at the index the chain gave it.
      expect(coinIndices(advanced.state)).toEqual([...walletIndices, treeSizeAtFork]);
      expect(coinValues(advanced.state)).toEqual([...walletValues, 900n].toSorted(ascending));
      expect(treeSize(advanced.state)).toBe(treeSizeAtFork + 1n);
      expect(advanced.state.progress.appliedIndex).toBe(block.number + 1n);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('carries the outputs it was still expecting, which nothing on the far side would announce again', async () =>
    Effect.gen(function* () {
      // A wallet owns more than the leaves in its tree: it also owns what it is *about* to receive. Building a
      // transfer to itself makes the wallet watch for an output whose commitment it knows and whose leaf is not on
      // chain — and the transfer is deliberately never submitted, so the expectation is still outstanding when the
      // boundary arrives. A crossing that reconstructs the wallet from its spendable coins alone drops it, and the
      // change of every in-flight transfer with it.
      const { wallet, preForkExpected } = yield* crossTheFork(chainCoins(), (running) =>
        Effect.promise(() =>
          running.shielded.transferTransaction([
            { amount: 150n, type: v8.shieldedToken().raw, receiverAddress: ownAddress() },
          ]),
        ).pipe(Effect.asVoid),
      );

      // The premise: the pre-fork wallet really was expecting something. Without this the comparison below could be
      // satisfied by two empty lists.
      expect(preForkExpected.length).toBeGreaterThan(0);

      const crossed = yield* settled(wallet);
      // Commitment for commitment, not merely count: a commitment is a function of the coin and its owner, so equal
      // commitments on either side of the boundary say these are the same expected coins and not new ones.
      expect(expectedCoins(crossed.state)).toEqual(preForkExpected);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('spends a carried coin against the post-fork chain', async () =>
    Effect.gen(function* () {
      const { postFork, wallet } = yield* crossTheFork(chainCoins());
      yield* settled(wallet);

      const transferred = 150n;
      const transfer = yield* Effect.promise(() =>
        wallet.shielded.transferTransaction([
          { amount: transferred, type: v9.shieldedToken().raw, receiverAddress: recipientAddress() },
        ]),
      );

      const block = yield* postFork.submitTransaction(
        carried<v9.UnprovenTransaction>(transfer, forkVersion).eraseProofs(),
      );
      // The chain accepting this is the claim, and it is the only one that cannot be faked: a spend carries a Merkle
      // path built from the wallet's own tree, and the ledger recognises it only if that path resolves to a root the
      // chain holds. A tree that crossed one index off, or lost a stranger's leaf on the way, would not reach one.
      expect(block.transactions[0].result.type).toBe('success');

      const afterSpend = yield* wallet.awaitState((state) => state.state.progress.appliedIndex > block.number);
      expect(totalValue(afterSpend.state)).toBe(walletTotal - transferred);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('does not migrate on a version bump that stays inside the running variant range', async () =>
    Effect.gen(function* () {
      // Same registration, one number different: the timeline activates a version the pre-fork variant still owns.
      // The version is written into state either way — what must not happen is a hand-over. There is no post-fork
      // chain here at all, and asking for one would hang, which is exactly the claim.
      const coins = chainCoins();
      const chain = yield* V8.Simulator.init({ networkId, blockProducer: preForkProducer() });
      yield* chain.scheduleFork(forkBlock, withinRangeVersion);
      yield* Effect.forEach(coins, (coin) => chain.submitTransaction(preForkPayment(networkId, coin)), {
        discard: true,
      });

      const wallet = yield* makeForkWallet({
        preFork: chain,
        postFork: Effect.never,
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
      const fork = yield* forkingChain(coins);
      yield* Effect.forEach(coins, (coin) => fork.preFork.submitTransaction(preForkPayment(networkId, coin)), {
        discard: true,
      });
      const postFork = yield* fork.advanceToFork();

      const wallet = yield* makeForkWallet({
        preFork: fork.preFork,
        postFork: Effect.succeed(postFork),
        networkId,
        forkVersion,
        seed,
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      const migration = yield* wallet.awaitMigration;
      expect(migration.from.appliedIndex).toBe(forkBlock);
      // Reached in one batch rather than two, and the same state crosses: where the split happened does not change
      // what the next variant inherits.
      expect(migration.to.coinCount).toBe(walletValues.length);
      expect(migration.to.firstFree).toBe(treeSizeAtFork);
      expect(migration.to.appliedIndex).toBe(forkBlock);

      // The end state is the same as the live transition reaches, which is the point: how the timeline was delivered
      // is not supposed to change what the wallet ends up holding.
      const crossed = yield* settled(wallet);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(coinValues(crossed.state).toSorted(ascending)).toEqual([...walletValues]);
      expect(coinIndices(crossed.state)).toEqual(walletIndices);
      expect(treeSize(crossed.state)).toBe(treeSizeAtFork);
      expect(awaitingCoinHashes(crossed.state)).toBe(false);
      expect(crossed.state.progress.appliedIndex).toBe(forkBlock + 1n);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('a migration that leaves the wallet’s state behind', () => {
  /** What a sync failure was really caused by — the ledger's throw, which the variant wraps as it comes past. */
  const underlying = (error: unknown): string =>
    error instanceof WalletError.OtherWalletError ? String(error.cause) : String(error);

  /** The parked cursor a migration hands to the next variant: at the boundary, connected to nothing yet. */
  const parkedAtFork: SyncProgress.SyncProgressData = {
    appliedIndex: forkBlock,
    highestRelevantWalletIndex: forkBlock,
    highestIndex: forkBlock,
    highestRelevantIndex: forkBlock,
    isConnected: false,
  };

  /**
   * The sync loop as the running variant builds it, minus its retry.
   *
   * @remarks
   *   `RunningV2Variant.startSync` wraps exactly this in an unbounded exponential retry, which is why the drill saw a
   *   wallet stuck at zero rather than an error: the failure below is permanent, so retrying it is retrying forever.
   *   Dropped here so the error is observable, because the error is the point.
   */
  const syncUntilItFails = (
    chain: Simulator,
    wallet: CoreWallet,
    secretKeys: v9.ZswapSecretKeys,
  ): Effect.Effect<void, WalletError.WalletError, Scope.Scope> =>
    Effect.gen(function* () {
      const stateRef = yield* SubscriptionRef.make(wallet);
      const capability = Sync.makeSimulatorSyncCapability();

      yield* Sync.makeSimulatorSyncService({ simulator: chain })
        .updates(wallet, secretKeys)
        .pipe(
          Stream.mapEffect((update) =>
            SubscriptionRef.modifyEffect(stateRef, (state) =>
              Effect.try({
                try: () => {
                  const [next, result] = capability.applyUpdate(state, update, postForkRange);
                  return [result, next] as const;
                },
                catch: (cause) =>
                  new WalletError.OtherWalletError({ message: 'Error while applying sync update', cause }),
              }),
            ),
          ),
          Stream.runDrain,
        );
    });

  it('wedges on the first post-fork event it meets', async () =>
    Effect.gen(function* () {
      // Kept as a permanent negative: this is what the shipped wallet did before its state crossed the boundary, and
      // what the 2026-08-28 hard-fork drill hit on real infrastructure. It passes only because the empty state
      // genuinely wedges — if a later change made a wallet that arrived empty survive a post-fork event, this test
      // would fail and carrying the state could be reconsidered on the evidence.
      const coins = chainCoins();
      const fork = yield* forkingChain(coins);
      yield* Effect.forEach(coins, (coin) => fork.preFork.submitTransaction(preForkPayment(networkId, coin)), {
        discard: true,
      });
      const postFork = yield* fork.advanceToFork();

      // A wallet arriving with identity, a parked cursor, and an empty tree. Hand-built rather than obtained by
      // disabling the crossing, which stays exactly as it ships.
      const coinless = CoreWallet.fromPreviousVersion({
        state: new v9.ZswapLocalState(),
        publicKeys: PublicKeys.fromSecretKeys(v9.ZswapSecretKeys.fromSeed(seed)),
        networkId,
        protocolVersion: forkVersion,
        progress: parkedAtFork,
      });
      expect(coinless.state.firstFree).toBe(0n);

      // Somebody pays this wallet after the fork. The commitment lands at the index the pre-fork tree ended on, which
      // is the whole difficulty: the chain never restarted its numbering, and this wallet's tree never left zero.
      yield* postFork.submitTransaction(
        postForkPayment(networkId, mintable(v9.shieldedToken().raw, 900n, walletRecipient())),
      );
      expect(yield* postFork.query((state) => state.ledger.zswap.firstFree)).toBe(treeSizeAtFork + 1n);

      const failure = yield* pipe(
        syncUntilItFails(postFork, coinless, v9.ZswapSecretKeys.fromSeed(seed)),
        // A guard, not a mechanism: without the wedge this stream never ends, and a hang says far less than a failed
        // assertion does.
        Effect.timeout(Duration.seconds(10)),
        Effect.flip,
      );

      expect(failure).toBeInstanceOf(WalletError.OtherWalletError);
      // The ledger's own words, and the exact arithmetic of the wedge: a tree at index 0 shown a commitment at 6.
      expect(underlying(failure)).toContain(
        'values inserted non-linearly into zswap commitment tree; expected to insert index 0, but received 6',
      );
    }).pipe(Effect.scoped, Effect.runPromise));
});
