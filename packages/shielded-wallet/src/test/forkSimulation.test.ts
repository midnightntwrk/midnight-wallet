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
 *   wallet, the V1 variant syncs it, the chain reaches the boundary height and its ledger is translated into the
 *   ledger-v9 one, the wallet hands over to the ledger-v9 variant — and comes out the other side still holding what it
 *   held, then goes on transacting.
 *
 *   **A fork re-announces nothing.** The chain's state translation carries every commitment across in place: the
 *   ledger-v9 chain opens holding the ledger-v8 tree, continues inserting at the index that tree reached, and the
 *   indexer numbers its events onwards from where it had got to. Nothing about the ledger-v8 timeline is served again.
 *   So the wallet's own state has to travel with it — which it does, as bytes: the two ledger majors either side of
 *   this boundary share the `zswap-local-state` codec, so the migration hands the previous version's serialization to
 *   this version's deserializer and the tree arrives whole (`src/v2/test/byteCrossing.test.ts` pins that codec). These
 *   tests are about what that buys, and the ledger-v9 chain here announces nothing precisely so that no assertion below
 *   can be satisfied by re-discovery.
 *
 *   The last test in the file is the failure mode of a migration that does not carry the state, kept deliberately: an
 *   empty tree in front of a chain that is six commitments tall, and the ledger refuses every event it is shown,
 *   forever.
 *
 *   **Unit tier, and complete.** The one thing this tier cannot supply is the real v8-to-v9 translation, which is a WASM
 *   artifact; `translationStub.ts` reconstructs ledger-v9 instead, and `forkSimulation.integration.test.ts` makes the
 *   same claims against the ledger team's own translation.
 */

import * as ledgerV8 from '@midnightntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion, type SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk-address-format';
import { ForkSimulator, V8, V9 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { type LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Deferred, Duration, Effect, Option, Ref, Schedule, Stream, SubscriptionRef, pipe, type Scope } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { type TransactionHistory as V1TransactionHistory, V1Tag } from '../v1/index.js';
import { CoreWallet, PublicKeys, Sync, type TransactionHistory, V2Tag, WalletError } from '../v2/index.js';
import {
  type CapturedMigration,
  type ForkWallet,
  type ForkWalletConfig,
  makeForkWallet,
  noOpV1History,
  noOpV2History,
} from './forkHarness.js';
import {
  type MintedCoin,
  mintable,
  v9Payment,
  v8Payment,
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
 * `forkVersion` is where the V2 variant is registered _and_ what the chain activates at `forkBlock` — the same number
 * reaching the runtime through registration and through the timeline, which is the whole point of D5. It is
 * deliberately an arbitrary number: the real fork's protocol version is not final, and nothing here may depend on it.
 */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
const forkBlock = 8n;

/** A version bump the V1 variant owns: inside `[MinSupportedVersion, forkVersion)`, so it must not migrate. */
const withinRangeVersion = ProtocolVersion.ProtocolVersion(5n);

/** The half-open range the V2 variant is registered over, as the runtime hands it to that variant. */
const v9Range = ProtocolVersion.makeRange(forkVersion, ProtocolVersion.MaxSupportedVersion);

const seed = Buffer.alloc(32, 42);
const otherSeed = Buffer.alloc(32, 43);

const v8Producer = () => V8.immediateBlockProducer(undefined, V8.genesisStrictness);
const v9Producer = () => V9.immediateBlockProducer(undefined, V9.genesisStrictness);

const walletRecipient = () => {
  const keys = ledgerV9.ZswapSecretKeys.fromSeed(seed);
  return { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey };
};

const strangerRecipient = () => {
  const keys = ledgerV9.ZswapSecretKeys.fromSeed(otherSeed);
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

/** The ledger-v8 commitment sequence, sampled once per chain: three to us, a stranger's, ours, a stranger's again. */
const chainCoins = (): readonly MintedCoin[] => {
  const tokenType = ledgerV8.shieldedToken().raw;
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

/** A chain that forks at `forkBlock`, its ledger-v9 side starting from the translation of what the ledger-v8 side held. */
const forkingChain = (coins: readonly MintedCoin[]): Effect.Effect<ForkSimulator, never, Scope.Scope> =>
  ForkSimulator.init({
    networkId,
    forkBlock,
    forkVersion,
    // Genesis strictness throughout: these payments mint from nothing and the transfer below pays no fees, both of
    // which a fee-enforcing chain would reject for reasons that have nothing to do with the fork.
    v8BlockProducer: v8Producer(),
    v9BlockProducer: v9Producer(),
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

/** A wallet that has synced the ledger-v8 chain, crossed the boundary, and the chain it now reads. */
type Crossing = Readonly<{
  v9: V9.Simulator;
  wallet: ForkWallet;
  migration: CapturedMigration;
  /**
   * The root of the tree the wallet held on the ledger-v8 side — what the crossing has to reproduce exactly.
   *
   * A number rather than the state it came from: the ledger-v8 state is built on the other ledger's wasm objects, whose
   * lifetime ends with the variant scope the migration closes.
   */
  v8Root: bigint | undefined;
  /** The outputs the wallet was still expecting on the ledger-v8 side — see {@link expectedCoins}. */
  v8Expected: readonly ExpectedCoin[];
}>;

/**
 * Runs the whole crossing: pay the wallet before the v9 fork, sync it, fork the chain, hand over.
 *
 * @remarks
 *   Stops short of asserting anything about the ledger-v9 side, which is what the individual tests differ on. The
 *   ledger-v8 state is awaited _before_ the chain is driven to the boundary, so the premise each test builds on — that
 *   the wallet genuinely held these coins on the other side — is established rather than inferred from the end state.
 */
const crossTheFork = (
  coins: readonly MintedCoin[],
  /** Anything the wallet is made to do on the ledger-v8 side after it has synced and before the boundary arrives. */
  beforeTheBoundary: (wallet: ForkWallet) => Effect.Effect<void, unknown> = () => Effect.void,
  /** Where each variant records tx history; a no-op history for any left out. */
  histories: Pick<ForkWalletConfig, 'v1History' | 'v2History'> = {},
): Effect.Effect<Crossing, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const fork = yield* forkingChain(coins);

    const wallet = yield* makeForkWallet({
      v8: fork.v8,
      v9: fork.awaitV9(),
      networkId,
      forkVersion,
      seed,
      ...histories,
    });
    yield* Effect.addFinalizer(() => wallet.stop);
    yield* wallet.start;

    // --- ledger-v8: the ledger-v8 variant syncs the ledger-v8 chain ----------------------------------------------
    yield* Effect.forEach(coins, (coin) => fork.v8.submitTransaction(v8Payment(networkId, coin)), {
      discard: true,
    });
    const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
    expect(yield* wallet.activeTag).toBe(V1Tag);
    expect(coinValues(synced.state)).toEqual([...walletValues]);
    expect(coinIndices(synced.state)).toEqual(walletIndices);
    expect(treeSize(synced.state)).toBe(treeSizeAtFork);

    yield* beforeTheBoundary(wallet);
    const v8State = yield* wallet.currentState;

    // --- the chain reaches the boundary and its ledger is translated ---------------------------------------------
    const v9 = yield* fork.advanceToFork();
    const migration = yield* wallet.awaitMigration;

    return {
      v9,
      wallet,
      migration,
      v8Root: merkleRoot(v8State.state),
      v8Expected: expectedCoins(v8State.state),
    };
  });

describe('a shielded wallet crossing a hard fork', () => {
  it('arrives holding the tree it held, against a chain that announces nothing', async () =>
    Effect.gen(function* () {
      const { v9, wallet, migration, v8Root } = yield* crossTheFork(chainCoins());
      expect(yield* wallet.activeTag).toBe(V2Tag);

      // What the V1 variant handed over: its identity, the version that triggered the hand-over, and a cursor
      // parked on the boundary height — observed and annotated, deliberately not applied.
      expect(migration.from.coinPublicKey).toBe(ledgerV8.ZswapSecretKeys.fromSeed(seed).coinPublicKey);
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
      // **Parked, not rewound.** The ledger-v9 timeline continues the indexer's event ids from where the fork found
      // them, so this wallet resumes on the cursor its predecessor stopped at.
      expect(migration.to.appliedIndex).toBe(migration.from.appliedIndex);
      expect(migration.to.appliedIndex).toBe(forkBlock);
      // Identity crosses too: without these keys the crossed coins cannot be recognised as this wallet's at all.
      expect(migration.to.coinPublicKey).toBe(ledgerV9.ZswapSecretKeys.fromSeed(seed).coinPublicKey);
      expect(migration.to.encryptionPublicKey).toBe(ledgerV9.ZswapSecretKeys.fromSeed(seed).encryptionPublicKey);
      expect(migration.to.networkId).toBe(networkId);
      // Kept so the restarted variant sits inside its own activation range instead of signalling backwards at once.
      expect(migration.to.protocolVersion).toBe(forkVersion);

      // --- ledger-v9: the same coins, without anything having been served ------------------------------------
      const crossed = yield* settled(wallet);
      expect(coinValues(crossed.state)).toEqual([...walletValues]);
      expect(coinIndices(crossed.state)).toEqual(walletIndices);
      // The whole tree, not just the leaves it owns: the strangers' commitments crossed with it, which is what keeps
      // the wallet's own leaves at the indices the chain has them at.
      expect(treeSize(crossed.state)).toBe(treeSizeAtFork);
      // And the hashes were computed on arrival — one per coin — so the wallet can name what it holds.
      expect(awaitingCoinHashes(crossed.state)).toBe(false);
      // And the tree is the tree it had before the boundary, down to its root — which is also the chain's.
      expect(v8Root).toBeDefined();
      expect(merkleRoot(crossed.state)).toBe(v8Root);
      expect(yield* v9.query(simulatedChainRoot)).toBe(v8Root);

      // **Carried, not re-discovered.** The ledger-v9 chain has produced exactly one block — its genesis, holding the
      // translated ledger — and it contains no transactions at all. There was nothing here for the wallet to learn
      // its coins from, so it did not learn them: it arrived with them.
      expect(yield* v9.query((state) => state.blocks.flatMap((block) => block.transactions))).toEqual([]);
      // That empty boundary block is what the wallet did read, and all it read: the version bump, applied.
      expect(crossed.state.progress.appliedIndex).toBe(forkBlock + 1n);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('applies a ledger-v9 payment landing where the ledger-v8 tree ended', async () =>
    Effect.gen(function* () {
      // The regression the 2026-08-28 drill found on real infrastructure. The chain goes on inserting at the index the
      // ledger-v8 tree reached, so the first commitment a crossed wallet meets is at `treeSize` — an index an empty
      // local state rejects as a non-linear insertion, and goes on rejecting. Against the tree that crossed with the
      // wallet it is simply the next leaf.
      //
      // Paid without waiting for the wallet to settle first, deliberately: the drill's wallet met a ledger-v9 event
      // while it had done nothing about the fork yet, and that ordering is half the regression. It survives it because
      // the migration is what completes the crossing, not something sync has still to do afterwards.
      const { v9, wallet } = yield* crossTheFork(chainCoins());

      const late = mintable(ledgerV9.shieldedToken().raw, 900n, walletRecipient());
      const block = yield* v9.submitTransaction(v9Payment(networkId, late));
      expect(block.transactions[0].result.type).toBe('success');
      expect(yield* v9.query((state) => state.ledger.zswap.firstFree)).toBe(treeSizeAtFork + 1n);

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
      const { wallet, v8Expected } = yield* crossTheFork(chainCoins(), (running) =>
        Effect.promise(() =>
          running.shielded.transferTransaction([
            { amount: 150n, type: ledgerV8.shieldedToken().raw, receiverAddress: ownAddress() },
          ]),
        ).pipe(Effect.asVoid),
      );

      // The premise: the V1 wallet really was expecting something. Without this the comparison below could be
      // satisfied by two empty lists.
      expect(v8Expected.length).toBeGreaterThan(0);

      const crossed = yield* settled(wallet);
      // Commitment for commitment, not merely count: a commitment is a function of the coin and its owner, so equal
      // commitments on either side of the boundary say these are the same expected coins and not new ones.
      expect(expectedCoins(crossed.state)).toEqual(v8Expected);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('spends a carried coin against the ledger-v9 chain', async () =>
    Effect.gen(function* () {
      const { v9, wallet } = yield* crossTheFork(chainCoins());
      yield* settled(wallet);

      const transferred = 150n;
      const transfer = yield* Effect.promise(() =>
        wallet.shielded.transferTransaction([
          { amount: transferred, type: ledgerV9.shieldedToken().raw, receiverAddress: recipientAddress() },
        ]),
      );

      const block = yield* v9.submitTransaction(
        carried<ledgerV9.UnprovenTransaction>(transfer, forkVersion).eraseProofs(),
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
      // Same registration, one number different: the timeline activates a version the V1 variant still owns.
      // The version is written into state either way — what must not happen is a hand-over. There is no ledger-v9
      // chain here at all, and asking for one would hang, which is exactly the claim.
      const coins = chainCoins();
      const chain = yield* V8.Simulator.init({ networkId, blockProducer: v8Producer() });
      yield* chain.scheduleFork(forkBlock, withinRangeVersion);
      yield* Effect.forEach(coins, (coin) => chain.submitTransaction(v8Payment(networkId, coin)), {
        discard: true,
      });

      const wallet = yield* makeForkWallet({
        v8: chain,
        v9: Effect.never,
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
      // Scenario 2: a wallet started from seed after the v9 fork has happened. Its V1 variant meets the whole
      // ledger-v8 history in a single batch, so the boundary is split *within* one update rather than across two.
      const coins = chainCoins();
      const fork = yield* forkingChain(coins);
      yield* Effect.forEach(coins, (coin) => fork.v8.submitTransaction(v8Payment(networkId, coin)), {
        discard: true,
      });
      const v9 = yield* fork.advanceToFork();

      const wallet = yield* makeForkWallet({
        v8: fork.v8,
        v9: Effect.succeed(v9),
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

  it('should write each transaction of the batch that hands over once, whole, because the hand-over must not cut its history write short', async () =>
    Effect.gen(function* () {
      // The whole ledger-v8 history and the fork arrive in one batch, so the batch that pays the wallet is the one
      // that hands over. Each history write is held until the V2 variant is running: it is still in flight when the
      // V1 variant closes, which is the moment a write tied to that variant's lifetime is lost.
      const coins = chainCoins();
      const fork = yield* forkingChain(coins);
      yield* Effect.forEach(coins, (coin) => fork.v8.submitTransaction(v8Payment(networkId, coin)), {
        discard: true,
      });
      const v9 = yield* fork.advanceToFork();
      // The premise: the ledger-v8 chain stands at the fork before the wallet starts, and the simulator sync's first
      // update is the chain's latest state, so that one update carries the whole ledger-v8 history and the fork.
      expect(yield* fork.v8.query(V8.getCurrentBlockNumber)).toBeGreaterThanOrEqual(forkBlock);

      const handedOver = yield* Deferred.make<void>();
      const written = yield* Ref.make<readonly WrittenSection[]>([]);

      const wallet = yield* makeForkWallet({
        v8: fork.v8,
        v9: Effect.succeed(v9),
        networkId,
        forkVersion,
        seed,
        v1History: historyHeldUntil(handedOver, written),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      yield* wallet.awaitMigration;
      yield* settled(wallet);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      yield* Deferred.succeed(handedOver, undefined);

      expectEachPaymentOnce(yield* writtenAtLeast(written, walletValues.length));
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should finish a history write already running when the wallet hands over, because its batch is applied and nothing will record it again', async () =>
    Effect.gen(function* () {
      // The wallet is paid and syncs the payments well before the boundary, in batches of their own. Their history
      // writes are held until the V2 variant is running, so they are still in flight when a later batch hands over.
      const handedOver = yield* Deferred.make<void>();
      const written = yield* Ref.make<readonly WrittenSection[]>([]);

      const { wallet } = yield* crossTheFork(
        chainCoins(),
        (wallet) =>
          Effect.gen(function* () {
            // The premise: the payments are applied, and their writes are running but not done.
            expect(yield* Ref.get(written)).toEqual([]);
            expect(yield* wallet.activeTag).toBe(V1Tag);
          }),
        { v1History: historyHeldUntil(handedOver, written) },
      );
      yield* settled(wallet);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      yield* Deferred.succeed(handedOver, undefined);

      expectEachPaymentOnce(yield* writtenAtLeast(written, walletValues.length));
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should stop promptly, interrupting history writes still running from before the hand-over, because a write must neither hold up nor outlive the wallet', async () =>
    Effect.gen(function* () {
      // Writes that never finish, carried past the hand-over: the V1 variant is gone, so nothing but the wallet's own
      // lifetime bounds them.
      const interrupted = yield* Ref.make(0);

      const { wallet } = yield* crossTheFork(chainCoins(), undefined, {
        v1History: historyThatNeverLands(interrupted),
      });
      yield* settled(wallet);
      // The premise: the writes are still running after the hand-over.
      expect(yield* Ref.get(interrupted)).toBe(0);

      const stopped = yield* wallet.stop.pipe(Effect.timeoutOption(Duration.seconds(2)));
      expect(Option.isSome(stopped)).toBe(true);
      expect(yield* Ref.get(interrupted)).toBe(walletValues.length);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should write the history of a payment the V2 variant syncs after the hand-over, because the variant a hand-over starts records its own transactions too', async () =>
    Effect.gen(function* () {
      const written = yield* Ref.make<readonly WrittenSection[]>([]);

      const { v9, wallet } = yield* crossTheFork(chainCoins(), undefined, {
        v2History: v2HistoryRecordedIn(written),
      });
      yield* settled(wallet);
      expect(yield* wallet.activeTag).toBe(V2Tag);

      const late = mintable(ledgerV9.shieldedToken().raw, 900n, walletRecipient());
      yield* v9.submitTransaction(v9Payment(networkId, late));
      yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal + 900n);

      const sections = yield* writtenAtLeast(written, 1);
      expect(sections.map(({ received, spent }) => ({ received, spent }))).toEqual([{ received: [900n], spent: [] }]);
    }).pipe(Effect.scoped, Effect.runPromise));
});

/** V2 transaction history whose every write lands in `written` at once. */
const v2HistoryRecordedIn = (
  written: Ref.Ref<readonly WrittenSection[]>,
): TransactionHistory.TransactionHistoryService => ({
  ...noOpV2History,
  put: (changes) => Ref.update(written, (sections) => [...sections, sectionOf(changes)]),
});

describe('a hand-over while history writes are still running', () => {
  it('should serve wallet calls from the V2 variant before those writes finish, because waiting on them would leave calls reaching the closed V1 variant', async () =>
    Effect.gen(function* () {
      // The V1 variant's writes are held until the test has made its call, so the hand-over can only complete while
      // they are running.
      const coins = chainCoins();
      const fork = yield* forkingChain(coins);
      const release = yield* Deferred.make<void>();
      const written = yield* Ref.make<readonly WrittenSection[]>([]);

      const wallet = yield* makeForkWallet({
        v8: fork.v8,
        v9: fork.awaitV9(),
        networkId,
        forkVersion,
        seed,
        v1History: historyHeldUntil(release, written),
      });
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.zipRight(wallet.stop)));
      yield* wallet.start;

      yield* Effect.forEach(coins, (coin) => fork.v8.submitTransaction(v8Payment(networkId, coin)), {
        discard: true,
      });
      yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      yield* fork.advanceToFork();

      const served = yield* pipe(
        Effect.gen(function* () {
          yield* wallet.awaitMigration;
          yield* settled(wallet);
          const tag = yield* wallet.activeTag;
          const transfer = yield* Effect.promise(() =>
            wallet.shielded.transferTransaction([
              { amount: 150n, type: ledgerV9.shieldedToken().raw, receiverAddress: recipientAddress() },
            ]),
          );
          // Built by the V2 variant: a transaction carries the version of the ledger that built it.
          return { tag, builtFromFork: transfer.protocolVersion >= forkVersion };
        }),
        Effect.timeoutOption(Duration.seconds(5)),
      );

      // The premise: no write had finished while the call was served.
      expect(yield* Ref.get(written)).toEqual([]);
      expect(served).toStrictEqual(Option.some({ tag: V2Tag, builtFromFork: true }));
    }).pipe(Effect.scoped, Effect.runPromise));
});

/** V1 transaction history whose every write runs forever, counting the ones interrupted. */
const historyThatNeverLands = (interrupted: Ref.Ref<number>): V1TransactionHistory.TransactionHistoryService => ({
  ...noOpV1History,
  put: () => Effect.never.pipe(Effect.onInterrupt(() => Ref.update(interrupted, (count) => count + 1))),
});

/** One tx-history section as a variant handed it to storage. */
type WrittenSection = Readonly<{ source: string; received: readonly bigint[]; spent: readonly bigint[] }>;

/** The section a variant writes for `changes`: its transaction and the values it received and spent. */
const sectionOf = (
  changes: Readonly<{
    source: string;
    receivedCoins: readonly Readonly<{ value: bigint }>[];
    spentCoins: readonly Readonly<{ value: bigint }>[];
  }>,
): WrittenSection => ({
  source: changes.source,
  received: changes.receivedCoins.map((coin) => coin.value),
  spent: changes.spentCoins.map((coin) => coin.value),
});

/** V1 transaction history whose every write waits for `release`, then lands in `written`. */
const historyHeldUntil = (
  release: Deferred.Deferred<void>,
  written: Ref.Ref<readonly WrittenSection[]>,
): V1TransactionHistory.TransactionHistoryService => ({
  ...noOpV1History,
  put: (changes) =>
    Deferred.await(release).pipe(Effect.zipRight(Ref.update(written, (sections) => [...sections, sectionOf(changes)]))),
});

/** One section per transaction that paid the wallet, each holding its coin: nothing lost, nothing written twice. */
const expectEachPaymentOnce = (sections: readonly WrittenSection[]): void => {
  expect(new Set(sections.map((section) => section.source)).size).toBe(sections.length);
  expect(sections.map(({ received, spent }) => ({ received, spent })).toSorted(byFirstReceived)).toEqual(
    walletValues.map((value) => ({ received: [value], spent: [] })),
  );
};

const byFirstReceived = (a: { received: readonly bigint[] }, b: { received: readonly bigint[] }): number =>
  ascending(a.received[0] ?? 0n, b.received[0] ?? 0n);

/**
 * The sections written, once there are at least `count` of them or two seconds have passed.
 *
 * @remarks
 *   Bounded rather than awaited, so a write that never lands fails the assertion that follows with what was written,
 *   instead of hanging the test.
 */
const writtenAtLeast = (
  written: Ref.Ref<readonly WrittenSection[]>,
  count: number,
): Effect.Effect<readonly WrittenSection[]> =>
  Ref.get(written).pipe(
    Effect.filterOrFail((sections) => sections.length >= count),
    Effect.retry(Schedule.spaced(Duration.millis(10)).pipe(Schedule.upTo(Duration.seconds(2)))),
    Effect.orElse(() => Ref.get(written)),
  );

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
    chain: V9.Simulator,
    wallet: CoreWallet,
    secretKeys: ledgerV9.ZswapSecretKeys,
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
                  const [next, result] = capability.applyUpdate(state, update, v9Range);
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

  it('wedges on the first ledger-v9 event it meets', async () =>
    Effect.gen(function* () {
      // Kept as a permanent negative: this is what the shipped wallet did before its state crossed the boundary, and
      // what the 2026-08-28 hard-fork drill hit on real infrastructure. It passes only because the empty state
      // genuinely wedges — if a later change made a wallet that arrived empty survive a ledger-v9 event, this test
      // would fail and carrying the state could be reconsidered on the evidence.
      const coins = chainCoins();
      const fork = yield* forkingChain(coins);
      yield* Effect.forEach(coins, (coin) => fork.v8.submitTransaction(v8Payment(networkId, coin)), {
        discard: true,
      });
      const v9 = yield* fork.advanceToFork();

      // A wallet arriving with identity, a parked cursor, and an empty tree. Hand-built rather than obtained by
      // disabling the crossing, which stays exactly as it ships.
      const coinless = CoreWallet.fromPreviousVersion({
        state: new ledgerV9.ZswapLocalState(),
        publicKeys: PublicKeys.fromSecretKeys(ledgerV9.ZswapSecretKeys.fromSeed(seed)),
        networkId,
        protocolVersion: forkVersion,
        progress: parkedAtFork,
      });
      expect(coinless.state.firstFree).toBe(0n);

      // Somebody pays this wallet after the v9 fork. The commitment lands at the index the ledger-v8 tree ended on, which
      // is the whole difficulty: the chain never restarted its numbering, and this wallet's tree never left zero.
      yield* v9.submitTransaction(
        v9Payment(networkId, mintable(ledgerV9.shieldedToken().raw, 900n, walletRecipient())),
      );
      expect(yield* v9.query((state) => state.ledger.zswap.firstFree)).toBe(treeSizeAtFork + 1n);

      const failure = yield* pipe(
        syncUntilItFails(v9, coinless, ledgerV9.ZswapSecretKeys.fromSeed(seed)),
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

describe('a stop while history writes are still running', () => {
  it('should log each V1 write it interrupts, naming its transaction, because that section is never recorded', async () =>
    Effect.gen(function* () {
      const logs = yield* capturedConsole;
      const started = yield* Ref.make<readonly string[]>([]);

      const { wallet } = yield* crossTheFork(chainCoins(), undefined, {
        v1History: { ...noOpV1History, put: (changes) => writeThatNeverLands(started, changes.source) },
      });
      yield* settled(wallet);
      // The premise: one write per payment is running, carried past the hand-over.
      const running = yield* startedAtLeast(started, walletValues.length);
      expect(running).toHaveLength(walletValues.length);

      yield* wallet.stop;

      expect(running.filter((source) => !loggedAsNotRecorded(logs, source))).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should log each V2 write it interrupts, naming its transaction, because that section is never recorded', async () =>
    Effect.gen(function* () {
      const logs = yield* capturedConsole;
      const started = yield* Ref.make<readonly string[]>([]);

      const { v9, wallet } = yield* crossTheFork(chainCoins(), undefined, {
        v2History: { ...noOpV2History, put: (changes) => writeThatNeverLands(started, changes.source) },
      });
      yield* settled(wallet);
      const late = mintable(ledgerV9.shieldedToken().raw, 900n, walletRecipient());
      yield* v9.submitTransaction(v9Payment(networkId, late));
      yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal + 900n);
      // The premise: the V2 variant's write for that payment is running.
      const running = yield* startedAtLeast(started, 1);
      expect(running).toHaveLength(1);

      yield* wallet.stop;

      expect(running.filter((source) => !loggedAsNotRecorded(logs, source))).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));
});

/** A history write that records the transaction it was started for, then never finishes. */
const writeThatNeverLands = (started: Ref.Ref<readonly string[]>, source: string): Effect.Effect<void> =>
  Ref.update(started, (sources) => [...sources, source]).pipe(Effect.zipRight(Effect.never));

/** The writes started, once there are at least `count` of them or two seconds have passed. */
const startedAtLeast = (started: Ref.Ref<readonly string[]>, count: number): Effect.Effect<readonly string[]> =>
  Ref.get(started).pipe(
    Effect.filterOrFail((sources) => sources.length >= count),
    Effect.retry(Schedule.spaced(Duration.millis(10)).pipe(Schedule.upTo(Duration.seconds(2)))),
    Effect.orElse(() => Ref.get(started)),
  );

/**
 * Every line written to the console for the rest of the scope, while the console itself stays quiet.
 *
 * @remarks
 *   The wallet runs on its own Effect runtime behind a Promise API, so its log lines reach only the global console, not a
 *   logger the test could provide. The array is mutated by the spies: it is test scaffolding, released with the scope.
 */
const capturedConsole: Effect.Effect<readonly string[], never, Scope.Scope> = Effect.acquireRelease(
  Effect.sync(() => {
    const lines: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      }),
    );
    return { lines, spies };
  }),
  ({ spies }) => Effect.sync(() => spies.forEach((spy) => spy.mockRestore())),
).pipe(Effect.map(({ lines }) => lines));

/** Whether a warning says the history section of `source` was not recorded. */
const loggedAsNotRecorded = (lines: readonly string[], source: string): boolean =>
  lines.some((line) => line.includes(source) && /not recorded/.test(line));
