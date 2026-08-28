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
 * Re-anchoring a wallet that crossed the ledger-version boundary.
 *
 * @remarks
 *   A wallet migrated across a hard fork arrives holding its coins as plain data — token type, nonce, value and the
 *   Merkle index each coin had in the pre-fork commitment tree — plus the size that tree had reached. Anchoring is what
 *   turns that back into a local state of this ledger version: walk the indices in order, insert the coins that belong
 *   to this wallet, and fast-forward over everybody else's with collapsed Merkle updates, until the rebuilt tree is as
 *   tall as the one left behind.
 *
 *   Two things are worth saying about how this file tests that. First, the ledger objects are real: a genuine
 *   {@link ledger.ZswapChainState} with this wallet's coins interleaved between another party's, so the gaps are real
 *   gaps and the collapsed updates are the ones a chain would actually hand over. Second, the proof that the rebuild is
 *   _correct_ — and not merely tall enough — is left to the ledger: a spend built from the anchored state is applied to
 *   the very chain state it was anchored against, and the chain checks the Merkle root the spend was built under. The
 *   companion negative case, spending from a tree rebuilt without the gaps, is what shows that assertion has teeth.
 */

import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion, type SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import { Array as EArray, Either, Order, pipe, Record as ERecord } from 'effect';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type CarriedCoin, CoreWallet, type PendingAnchor, PublicKeys } from '../CoreWallet.js';

const networkId = NetworkId.NetworkId.Undeployed;
const tokenType = ledger.shieldedToken().raw;

/** The wallet under test, and the other party whose coins sit between its own. */
const myKeys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 3));
const theirKeys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 4));

/** The version that triggered the hand-over, and the cursor the previous variant stopped at. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
const parkedProgress: SyncProgress.SyncProgressData = {
  appliedIndex: 4321n,
  highestRelevantWalletIndex: 4400n,
  highestIndex: 4400n,
  highestRelevantIndex: 4400n,
  isConnected: false,
};

type Ownership = 'mine' | 'theirs';

/** One commitment on the simulated chain: whose coin it is, what it is, and where it landed. */
type ChainCoin = Readonly<{ owner: Ownership; coin: ledger.ShieldedCoinInfo; mtIndex: bigint }>;

type BuiltChain = Readonly<{ state: ledger.ZswapChainState; coins: readonly ChainCoin[] }>;

/** Pays a fresh coin to `keys`: one output, therefore one commitment, therefore one Merkle index. */
const payment = (
  keys: ledger.ZswapSecretKeys,
  value: bigint,
): [ledger.ShieldedCoinInfo, ledger.ZswapOffer<ledger.PreProof>] => {
  const coin = ledger.createShieldedCoinInfo(tokenType, value);
  const output = ledger.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey);
  return [coin, ledger.ZswapOffer.fromOutput(output, coin.type, coin.value)];
};

/**
 * Builds a chain state holding one coin per entry of `ownerships`, in that order.
 *
 * @remarks
 *   Applied one offer at a time so that each coin gets an index of its own and the interleaving is exactly the one asked
 *   for; the index each commitment landed at is read back off `tryApply` rather than assumed. The closing
 *   `postBlockUpdate` is not decoration, twice over: it is what rehashes the commitment tree — constructing a
 *   {@link ledger.MerkleTreeCollapsedUpdate} over an unrehashed stretch throws `attempted update without the tree being
 *   fully rehashed` — and what registers the resulting root as valid, without which the chain answers every spend,
 *   however honestly built, with `use of unknown coin tree root`.
 */
const buildChain = (ownerships: readonly Ownership[]): BuiltChain =>
  pipe(
    ownerships,
    EArray.reduce({ state: new ledger.ZswapChainState(), coins: [] as readonly ChainCoin[] }, (acc, owner, index) => {
      const [coin, offer] = payment(owner === 'mine' ? myKeys() : theirKeys(), BigInt((index + 1) * 100));
      const [nextState, indices] = acc.state.tryApply(offer);
      return {
        state: nextState,
        coins: [...acc.coins, { owner, coin, mtIndex: [...indices.values()][0] }],
      };
    }),
    (built) => ({ ...built, state: built.state.postBlockUpdate(new Date(1_000), 3_600n) }),
  );

/** What the migration would have carried across for the wallet under test, given this chain. */
const carriedFrom = (built: BuiltChain): PendingAnchor => ({
  coins: pipe(
    built.coins,
    EArray.filter((entry) => entry.owner === 'mine'),
    EArray.map(({ coin, mtIndex }) => ({ type: coin.type, nonce: coin.nonce, value: coin.value, mtIndex })),
  ),
  treeSize: built.state.firstFree,
});

/** A wallet as the cross-ledger migration leaves it: identity and position, coins still pending. */
const crossedWallet = (pendingAnchor: PendingAnchor): CoreWallet =>
  CoreWallet.fromPreviousVersion({
    publicKeys: PublicKeys.fromSecretKeys(myKeys()),
    networkId,
    protocolVersion: forkVersion,
    progress: parkedProgress,
    pendingAnchor,
  });

/** The collapsed updates a source would hand back for `gaps`, taken off the chain the wallet is being anchored to. */
const updatesFor = (
  built: BuiltChain,
  gaps: readonly Readonly<{ start: bigint; end: bigint }>[],
): readonly ledger.MerkleTreeCollapsedUpdate[] =>
  gaps.map((gap) => new ledger.MerkleTreeCollapsedUpdate(built.state, gap.start, gap.end));

/** The Merkle root of a chain's tree, read through a local state — the chain state does not expose one. */
const chainRoot = (built: BuiltChain): bigint | undefined =>
  built.state.firstFree === 0n
    ? new ledger.ZswapLocalState().merkleTreeRoot
    : new ledger.ZswapLocalState().applyCollapsedUpdate(
        new ledger.MerkleTreeCollapsedUpdate(built.state, 0n, built.state.firstFree - 1n),
      ).merkleTreeRoot;

/** Carried coins as plain data, for the gap arithmetic, where the coin contents themselves do not matter. */
const coinsAt = (indices: readonly bigint[]): readonly CarriedCoin[] =>
  indices.map((mtIndex) => ({ type: tokenType, nonce: 'ab'.repeat(32), value: 1n, mtIndex }));

const gapsOf = (indices: readonly bigint[], treeSize: bigint): readonly Readonly<{ start: bigint; end: bigint }>[] =>
  CoreWallet.anchorGaps({ coins: coinsAt(indices), treeSize });

describe('what the ledger itself guarantees about collapsed updates', () => {
  // The anchor fold leans on exact index arithmetic, so the arithmetic the ledger implements is pinned here rather
  // than assumed from its documentation ("both ends of updates *are* included", ledger-v9.d.ts:3007).
  const built = buildChain(['theirs', 'theirs', 'theirs']);

  it('takes inclusive bounds: [0, firstFree - 1] covers the whole tree, and an empty tree has no index at all', () => {
    const whole = new ledger.MerkleTreeCollapsedUpdate(built.state, 0n, built.state.firstFree - 1n);

    expect(new ledger.ZswapLocalState().applyCollapsedUpdate(whole).firstFree).toBe(built.state.firstFree);
    expect(() => new ledger.MerkleTreeCollapsedUpdate(new ledger.ZswapChainState(), 0n, 0n)).toThrow(
      /attempted update/,
    );
    expect(() => new ledger.MerkleTreeCollapsedUpdate(built.state, 2n, 1n)).toThrow(/end \(1\) after before \(2\)/);
  });

  it('accepts a misaligned update silently, which is why the anchor fold must check alignment itself', () => {
    // Applying [1, 2] to a state whose firstFree is 0 does not throw: the local tree just adopts the range and
    // firstFree jumps to end + 1. Nothing downstream of the ledger would ever notice the hole at index 0.
    const misaligned = new ledger.ZswapLocalState().applyCollapsedUpdate(
      new ledger.MerkleTreeCollapsedUpdate(built.state, 1n, 2n),
    );

    expect(misaligned.firstFree).toBe(3n);
  });
});

describe('the gaps a carried wallet has to fill', () => {
  it('asks for the whole tree when no coins crossed', () => {
    expect(gapsOf([], 6n)).toEqual([{ start: 0n, end: 5n }]);
  });

  it('asks for nothing when the pre-fork tree was empty', () => {
    expect(gapsOf([], 0n)).toEqual([]);
  });

  it('asks only for what follows coins that run contiguously from the start', () => {
    expect(gapsOf([0n, 1n, 2n], 5n)).toEqual([{ start: 3n, end: 4n }]);
  });

  it('leaves no empty range between adjacent coins', () => {
    expect(gapsOf([1n, 2n], 4n)).toEqual([
      { start: 0n, end: 0n },
      { start: 3n, end: 3n },
    ]);
  });

  it('asks for nothing after a coin that sat at the last index', () => {
    expect(gapsOf([2n], 3n)).toEqual([{ start: 0n, end: 1n }]);
    expect(gapsOf([0n], 1n)).toEqual([]);
  });

  it('orders the ranges ascending however the coins were listed', () => {
    expect(gapsOf([4n, 1n], 6n)).toEqual([
      { start: 0n, end: 0n },
      { start: 2n, end: 3n },
      { start: 5n, end: 5n },
    ]);
  });

  it('partitions the pre-fork tree between the gaps and the carried coins', () => {
    const anchorArbitrary: fc.Arbitrary<PendingAnchor> = fc
      .integer({ min: 0, max: 40 })
      .chain((size) =>
        (size === 0
          ? fc.constant<readonly number[]>([])
          : fc.uniqueArray(fc.integer({ min: 0, max: size - 1 }), { maxLength: size })
        ).map((indices) => ({ coins: coinsAt(indices.map(BigInt)), treeSize: BigInt(size) })),
      );

    fc.assert(
      fc.property(anchorArbitrary, (anchor) => {
        const gaps = CoreWallet.anchorGaps(anchor);

        // Inclusive bounds, never inverted, never overlapping, always ascending.
        gaps.forEach((gap) => expect(gap.end).toBeGreaterThanOrEqual(gap.start));
        EArray.zip(gaps, gaps.slice(1)).forEach(([earlier, later]) => expect(later.start).toBeGreaterThan(earlier.end));

        const covered = gaps.flatMap((gap) => EArray.range(Number(gap.start), Number(gap.end)).map(BigInt));
        const owned = anchor.coins.map((coin) => coin.mtIndex);
        const together = pipe([...covered, ...owned], EArray.sort(Order.bigint));

        // Nothing counted twice, and between them they cover [0, treeSize) exactly.
        expect(new Set(together).size).toBe(covered.length + owned.length);
        expect(together).toEqual(
          anchor.treeSize === 0n ? [] : EArray.range(0, Number(anchor.treeSize) - 1).map(BigInt),
        );
      }),
      { numRuns: 200 },
    );
  });
});

describe('anchoring against a real chain', () => {
  // Two coins of this wallet's, at indices 1 and 4, with four of somebody else's around them.
  const built = buildChain(['theirs', 'mine', 'theirs', 'theirs', 'mine', 'theirs']);
  const pendingAnchor = carriedFrom(built);
  const anchorHere = (wallet: CoreWallet = crossedWallet(pendingAnchor)): Either.Either<CoreWallet, unknown> =>
    CoreWallet.anchor(
      wallet,
      myKeys(),
      updatesFor(built, CoreWallet.anchorGaps(wallet.pendingAnchor ?? { coins: [], treeSize: 0n })),
    );

  const anchored = (): CoreWallet => Either.getOrThrowWith(anchorHere(), (error) => new Error(String(error)));

  it('rebuilds a tree as tall as the one left behind', () => {
    expect(pendingAnchor.treeSize).toBe(6n);
    expect(anchored().state.firstFree).toBe(6n);
  });

  it('holds exactly the coins that crossed, at the indices they had', () => {
    const held = pipe(
      [...anchored().state.coins],
      EArray.sort(Order.mapInput(Order.bigint, (coin: ledger.QualifiedShieldedCoinInfo) => coin.mt_index)),
      EArray.map((coin) => ({ type: coin.type, nonce: coin.nonce, value: coin.value, mtIndex: coin.mt_index })),
    );

    expect(held).toEqual([...pendingAnchor.coins]);
  });

  it('reproduces the Merkle root of the chain it was anchored to', () => {
    expect(anchored().state.merkleTreeRoot).toBe(chainRoot(built));
  });

  it('recomputes the coin hashes from the keys and the rebuilt state', () => {
    const keys = myKeys();
    const wallet = anchored();

    expect(pipe(wallet.coinHashes, ERecord.keys, EArray.sort(Order.string))).toEqual(
      pipe(
        pendingAnchor.coins.map((coin) => coin.nonce),
        EArray.sort(Order.string),
      ),
    );
    pendingAnchor.coins.forEach((carried) => {
      const coin = { type: carried.type, nonce: carried.nonce, value: carried.value };
      expect(wallet.coinHashes[carried.nonce]).toEqual({
        commitment: ledger.coinCommitment(coin, keys.coinPublicKey),
        nullifier: ledger.coinNullifier(coin, keys.coinSecretKey),
      });
    });
  });

  it('leaves nothing pending, and carries identity, position and version through untouched', () => {
    const before = crossedWallet(pendingAnchor);
    const wallet = Either.getOrThrowWith(anchorHere(before), (error) => new Error(String(error)));

    expect(wallet.pendingAnchor).toBeUndefined();
    expect(wallet.publicKeys).toEqual(before.publicKeys);
    expect(wallet.networkId).toBe(before.networkId);
    expect(wallet.protocolVersion).toBe(before.protocolVersion);
    expect(wallet.progress).toEqual(before.progress);
  });

  it('anchors however the carried coins were listed', () => {
    // The order is the migration's promise, not the fold's precondition: a hand-built or deserialized payload may
    // list the coins any way it likes, and the walk still has to happen in Merkle-index order.
    const reversed: PendingAnchor = { ...pendingAnchor, coins: [...pendingAnchor.coins].reverse() };

    const wallet = Either.getOrThrowWith(
      CoreWallet.anchor(crossedWallet(reversed), myKeys(), updatesFor(built, CoreWallet.anchorGaps(reversed))),
      (error) => new Error(String(error)),
    );

    expect(wallet.state.firstFree).toBe(6n);
    expect(
      pipe(
        [...wallet.state.coins],
        EArray.map((coin) => coin.mt_index),
        EArray.sort(Order.bigint),
      ),
    ).toEqual([1n, 4n]);
  });

  it('lets the chain accept a spend of a carried coin', () => {
    const wallet = anchored();
    const coin = [...wallet.state.coins][0];
    const [offers] = CoreWallet.spendCoins(wallet, myKeys(), [coin], 0);

    // The chain checks the Merkle root the spend was built under: accepting it is the ledger's own verdict that the
    // rebuilt tree is the tree this coin lives in.
    const [afterSpend] = built.state.tryApply(offers[0]);

    // And the nullifier really was consumed — the same spend cannot land twice.
    expect(() => afterSpend.tryApply(offers[0])).toThrow(/double-spend/);
  });

  it('would not, had the tree been rebuilt without the gaps', () => {
    // The control for the assertion above: same coins, same keys, same chain — only the skipped indices are missing,
    // so the tree the spend is built against is a different tree.
    const naive = pipe(
      pendingAnchor.coins,
      EArray.reduce(new ledger.ZswapLocalState(), (state, carried) =>
        state.insertCoin(myKeys(), { type: carried.type, nonce: carried.nonce, value: carried.value }),
      ),
    );
    const wallet = CoreWallet.init(naive, myKeys(), networkId);
    const [offers] = CoreWallet.spendCoins(wallet, myKeys(), [[...naive.coins][0]], 0);

    expect(() => built.state.tryApply(offers[0])).toThrow(/unknown coin tree root/);
  });

  it('fast-forwards the whole tree for a wallet that crossed with no coins', () => {
    const emptyHanded = buildChain(['theirs', 'theirs', 'theirs']);
    const anchor: PendingAnchor = { coins: [], treeSize: emptyHanded.state.firstFree };
    const gaps = CoreWallet.anchorGaps(anchor);

    const wallet = Either.getOrThrowWith(
      CoreWallet.anchor(crossedWallet(anchor), myKeys(), updatesFor(emptyHanded, gaps)),
      (error) => new Error(String(error)),
    );

    expect(gaps).toEqual([{ start: 0n, end: 2n }]);
    expect(wallet.state.firstFree).toBe(3n);
    expect([...wallet.state.coins]).toEqual([]);
    expect(wallet.pendingAnchor).toBeUndefined();
  });

  it('anchors a wallet that had seen nothing at all without asking for any update', () => {
    const anchor: PendingAnchor = { coins: [], treeSize: 0n };

    const wallet = Either.getOrThrowWith(
      CoreWallet.anchor(crossedWallet(anchor), myKeys(), []),
      (error) => new Error(String(error)),
    );

    expect(wallet.state.firstFree).toBe(0n);
    expect(wallet.pendingAnchor).toBeUndefined();
  });
});

describe('when anchoring cannot be done', () => {
  const built = buildChain(['theirs', 'mine', 'theirs', 'theirs', 'mine', 'theirs']);
  const pendingAnchor = carriedFrom(built);
  const gaps = CoreWallet.anchorGaps(pendingAnchor);

  it('refuses a wallet that has nothing pending', () => {
    const settled = CoreWallet.empty(PublicKeys.fromSecretKeys(myKeys()), networkId);

    const result = CoreWallet.anchor(settled, myKeys(), []);

    expect(Either.isLeft(result)).toBe(true);
  });

  it('refuses when fewer updates than gaps are supplied', () => {
    const result = CoreWallet.anchor(crossedWallet(pendingAnchor), myKeys(), updatesFor(built, gaps.slice(1)));

    expect(Either.isLeft(result)).toBe(true);
  });

  it('refuses when more updates than gaps are supplied', () => {
    const result = CoreWallet.anchor(crossedWallet(pendingAnchor), myKeys(), [
      ...updatesFor(built, gaps),
      new ledger.MerkleTreeCollapsedUpdate(built.state, 0n, 0n),
    ]);

    expect(Either.isLeft(result)).toBe(true);
  });

  it('refuses updates that do not cover the gaps they stand in for', () => {
    // As many updates as gaps, but the first two swapped. The ledger itself accepts a misaligned update without
    // complaint (pinned above), so only the fold's own arithmetic stands between this and a silently wrong tree.
    const [first, second, ...rest] = updatesFor(built, gaps);

    const result = CoreWallet.anchor(crossedWallet(pendingAnchor), myKeys(), [second, first, ...rest]);

    expect(Either.isLeft(result)).toBe(true);
  });

  it('refuses when the rebuilt tree does not reach the carried size', () => {
    // The same coins and the same updates, but claiming a tree one index taller than the chain ever grew: the gaps
    // still number three, so nothing is missing to count — only the finished height gives it away.
    const overstated: PendingAnchor = { ...pendingAnchor, treeSize: pendingAnchor.treeSize + 1n };

    const result = CoreWallet.anchor(crossedWallet(overstated), myKeys(), updatesFor(built, gaps));

    expect(CoreWallet.anchorGaps(overstated).length).toBe(gaps.length);
    expect(Either.isLeft(result)).toBe(true);
  });

  it('turns a ledger failure into a Left rather than a throw', () => {
    // A coin whose nonce is not hex: whatever produced it, the ledger will reject it, and a state transformation this
    // repository calls total is not allowed to answer that with an exception.
    const corrupted: PendingAnchor = {
      coins: [{ type: tokenType, nonce: 'not-a-nonce', value: 5n, mtIndex: 0n }],
      treeSize: 1n,
    };

    const result = CoreWallet.anchor(crossedWallet(corrupted), myKeys(), []);

    expect(Either.isLeft(result)).toBe(true);
  });
});
