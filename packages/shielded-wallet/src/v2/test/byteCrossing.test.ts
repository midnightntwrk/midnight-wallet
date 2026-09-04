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
 * The contract the cross-fork migration rests on: the two ledger majors share the `zswap-local-state` codec.
 *
 * @remarks
 *   `Migration.makeCrossLedgerMigration` carries a shielded wallet across a hard fork by handing the pre-fork ledger's
 *   serialized local state to the post-fork ledger's deserializer. That is the whole mechanism, and it is only sound
 *   because the fork did not move this particular codec: the transaction codec did move at this boundary,
 *   `zswap-local-state` did not. Nothing in either `.d.ts` states that, and neither offers a version-parameterised
 *   `deserialize`, so it is pinned here — against both real ledger modules, with no stubs anywhere in the file.
 *
 *   **If this file goes red, a ledger major has moved the local-state codec.** The failure will be loud: a header-tag
 *   mismatch thrown out of `deserialize`, which the migration turns into a `WalletError` rather than letting it escape.
 *   The fix is not to work around it here — it is to ask the ledger team for a local-state translation and install it
 *   in the `StateMigration` seam, exactly as the chain's own `LedgerState` translation is installed. Re-deriving the
 *   wallet from its spendable coins is _not_ an acceptable substitute: it silently drops `pendingOutputs`, the coins a
 *   wallet is owed but has not yet seen on chain, which no chain re-announces after a fork.
 *
 *   The world under test is real on both sides. A pre-fork chain is built with this wallet's coins interleaved between
 *   another party's, a pre-fork local state is grown against it exactly as a syncing wallet grows one, and the
 *   post-fork chain is `translationStub`'s construction: re-paying the same coins to the same public keys reproduces
 *   the pre-fork commitments, because a commitment is a function of the coin and its owner alone.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { Array as EArray, Either, Order, pipe } from 'effect';
import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

// Every test here does real cryptography in two WASM ledgers at once; on a loaded CI runner that
// legitimately outlasts the 30s default (observed: the property suite timing out while green locally).
vi.setConfig({ testTimeout: 120_000 });

// =============================================================================
// Instruments
// =============================================================================

/** Runs `fn`, keeping either its value or the exact text the ledger threw. */
const attempt = <A>(fn: () => A): Either.Either<A, string> =>
  Either.try({
    try: fn,
    catch: (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error)),
  });

/** The leading bytes of a serialization as ASCII, non-printables escaped, so a header tag is legible in a diff. */
const asAscii = (bytes: Uint8Array, limit: number): string =>
  pipe(
    [...bytes.slice(0, limit)],
    EArray.map((byte) =>
      byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : `\\x${byte.toString(16).padStart(2, '0')}`,
    ),
    EArray.join(''),
  );

/** Coins as plain comparable data, ascending by Merkle index — the shape both ledger versions express identically. */
type FlatCoin = Readonly<{ type: string; nonce: string; value: bigint; mtIndex: bigint }>;

const flatten = (coins: Iterable<{ type: string; nonce: string; value: bigint; mt_index: bigint }>): FlatCoin[] =>
  pipe(
    [...coins],
    EArray.map((coin) => ({ type: coin.type, nonce: coin.nonce, value: coin.value, mtIndex: coin.mt_index })),
    EArray.sort(Order.mapInput(Order.bigint, (coin: FlatCoin) => coin.mtIndex)),
  );

// =============================================================================
// The pre-fork world
// =============================================================================

const mySeed = Buffer.alloc(32, 3);
const theirSeed = Buffer.alloc(32, 4);

const v8Mine = (): v8.ZswapSecretKeys => v8.ZswapSecretKeys.fromSeed(mySeed);
const v8Theirs = (): v8.ZswapSecretKeys => v8.ZswapSecretKeys.fromSeed(theirSeed);
const v9Mine = (): v9.ZswapSecretKeys => v9.ZswapSecretKeys.fromSeed(mySeed);
const v9Theirs = (): v9.ZswapSecretKeys => v9.ZswapSecretKeys.fromSeed(theirSeed);

type Ownership = 'mine' | 'theirs';

/** This wallet's coins at Merkle indices 1 and 4, with somebody else's around and between them. */
const layout: readonly Ownership[] = ['theirs', 'mine', 'theirs', 'theirs', 'mine', 'theirs'];

type ChainCoin = Readonly<{
  owner: Ownership;
  coin: v8.ShieldedCoinInfo;
  offer: v8.ZswapOffer<v8.PreProof>;
  mtIndex: bigint;
}>;

const tokenType = v8.shieldedToken().raw;

const v8Payment = (
  keys: v8.ZswapSecretKeys,
  value: bigint,
): Readonly<{ coin: v8.ShieldedCoinInfo; offer: v8.ZswapOffer<v8.PreProof> }> => {
  const coin = v8.createShieldedCoinInfo(tokenType, value);
  const output = v8.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey);
  return { coin, offer: v8.ZswapOffer.fromOutput<v8.PreProof>(output, coin.type, coin.value) };
};

/** The pre-fork chain, one commitment per offer, rehashed at the end so collapsed updates can be cut from it. */
const preForkChain = pipe(
  layout,
  EArray.reduce({ state: new v8.ZswapChainState(), coins: [] as readonly ChainCoin[] }, (acc, owner, index) => {
    const { coin, offer } = v8Payment(owner === 'mine' ? v8Mine() : v8Theirs(), BigInt((index + 1) * 100));
    const [nextState, indices] = acc.state.tryApply(offer);
    return { state: nextState, coins: [...acc.coins, { owner, coin, offer, mtIndex: [...indices.values()][0] }] };
  }),
  (built) => ({ ...built, state: built.state.postBlockUpdate(new Date(1_000)) }),
);

/** A coin this wallet is told to expect but has not seen on chain: content for `pendingOutputs`. */
const watched = v8.createShieldedCoinInfo(tokenType, 777n);

/**
 * The pre-fork wallet's own local state, grown exactly as a syncing wallet grows one.
 *
 * @remarks
 *   Its own offers applied for the indices it owns, collapsed updates for everybody else's, walked in Merkle-index order
 *   — so the tree is the chain's tree and the coins sit where the chain put them.
 */
const preForkLocalState = pipe(
  preForkChain.coins,
  EArray.reduce(new v8.ZswapLocalState(), (state, entry) =>
    entry.owner === 'mine'
      ? state.apply(v8Mine(), entry.offer)
      : state.applyCollapsedUpdate(new v8.MerkleTreeCollapsedUpdate(preForkChain.state, entry.mtIndex, entry.mtIndex)),
  ),
  (state) => state.watchFor(v8Mine().coinPublicKey, watched),
);

const preForkBytes = preForkLocalState.serialize();
const sourceCoins = flatten(preForkLocalState.coins);

// =============================================================================
// The post-fork world: the chain the fork left behind
// =============================================================================

/**
 * The post-fork chain, holding the pre-fork commitments.
 *
 * @remarks
 *   The translation stub's construction (`src/test/translationStub.ts`), inlined here so this file depends on nothing but
 *   the two ledgers: re-pay each pre-fork coin — same token type, same nonce, same value, same recipient — in the same
 *   order on a fresh chain of the new ledger version.
 */
const postForkChain = pipe(
  preForkChain.coins,
  EArray.reduce(new v9.ZswapChainState(), (state, entry) => {
    const keys = entry.owner === 'mine' ? v9Mine() : v9Theirs();
    const coin = { type: entry.coin.type, nonce: entry.coin.nonce, value: entry.coin.value };
    const output = v9.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey);
    const [next] = state.tryApply(v9.ZswapOffer.fromOutput<v9.PreProof>(output, coin.type, coin.value));
    return next;
  }),
  (state) => state.postBlockUpdate(new Date(1_000), 3_600n),
);

/** The Merkle root of a chain's tree, read through a local state — a chain state does not expose one. */
const rootOf = (chain: v9.ZswapChainState): bigint | undefined =>
  chain.firstFree === 0n
    ? new v9.ZswapLocalState().merkleTreeRoot
    : new v9.ZswapLocalState().applyCollapsedUpdate(new v9.MerkleTreeCollapsedUpdate(chain, 0n, chain.firstFree - 1n))
        .merkleTreeRoot;

/** Builds a spend of `coin` off `state` and offers it to `chain`. */
const spendAgainst = (
  chain: v9.ZswapChainState,
  state: v9.ZswapLocalState,
  coin: v9.QualifiedShieldedCoinInfo,
): Either.Either<Readonly<{ chain: v9.ZswapChainState; offer: v9.ZswapOffer<v9.PreProof> }>, string> =>
  attempt(() => {
    const [, input] = state.spend(v9Mine(), coin, 0);
    const offer = v9.ZswapOffer.fromInput(input, coin.type, coin.value);
    const [applied] = chain.tryApply(offer);
    return { chain: applied, offer };
  });

// =============================================================================
// The crossing under test
// =============================================================================

const cross = (bytes: Uint8Array): v9.ZswapLocalState => v9.ZswapLocalState.deserialize(bytes);

describe('the codec the cross-fork migration rests on', () => {
  it('is the same one on both sides of the boundary, down to the header tag', () => {
    // The tags are compared as legible strings, not as byte arrays, so that a failure names both of them and says
    // straight away which major moved and to what.
    const tagOf = (bytes: Uint8Array): string => asAscii(bytes, 34);

    expect(tagOf(new v9.ZswapLocalState().serialize())).toBe(tagOf(new v8.ZswapLocalState().serialize()));
    expect(tagOf(new v8.ZswapLocalState().serialize())).toContain('zswap-local-state');

    // And the whole empty serialization, not merely its header: nothing else in the encoding drifted either.
    expect(
      Buffer.from(new v9.ZswapLocalState().serialize()).equals(Buffer.from(new v8.ZswapLocalState().serialize())),
    ).toBe(true);
  });

  it('does not extend to transactions, which is what makes this a claim about local state and not about the fork', () => {
    // The control that stops the test above being read as "the fork changed nothing". It changed the transaction
    // codec; local state is the exception, and that exception is precisely what the migration exploits.
    const tagOf = (bytes: Uint8Array): string => asAscii(bytes, 34);
    const v8Tag = tagOf(v8.Transaction.fromParts('undeployed', preForkChain.coins[1].offer).eraseProofs().serialize());
    const v9Output = v9.ZswapOutput.new(
      { type: tokenType, nonce: watched.nonce, value: watched.value },
      0,
      v9Mine().coinPublicKey,
      v9Mine().encryptionPublicKey,
    );
    const v9Tag = tagOf(
      v9.Transaction.fromParts('undeployed', v9.ZswapOffer.fromOutput<v9.PreProof>(v9Output, tokenType, watched.value))
        .eraseProofs()
        .serialize(),
    );

    expect(v9Tag).not.toBe(v8Tag);
  });
});

describe('a pre-fork local state read by the post-fork ledger', () => {
  it('decodes, and re-serializes to the very bytes it came from', () => {
    const crossed = cross(preForkBytes);

    expect(Buffer.from(crossed.serialize()).equals(Buffer.from(preForkBytes))).toBe(true);
  });

  it('says everything the source said: coins, height, root, and the outputs still expected', () => {
    const crossed = cross(preForkBytes);

    // The premise, read off the source rather than assumed: two coins at indices 1 and 4, in a tree six leaves tall,
    // with one output outstanding.
    expect(sourceCoins.map((coin) => coin.mtIndex)).toEqual([1n, 4n]);
    expect(preForkLocalState.firstFree).toBe(6n);
    expect(preForkLocalState.pendingOutputs.size).toBe(1);

    expect(flatten(crossed.coins)).toEqual(sourceCoins);
    expect(crossed.firstFree).toBe(preForkLocalState.firstFree);
    // The single number that says this is the same tree and not merely a tree with the same leaves the wallet owns.
    expect(crossed.merkleTreeRoot).toBe(rootOf(postForkChain));

    // `pendingOutputs` compared by content, not by count. This is the member a reconstruction from spendable coins
    // silently loses, so it is the reason the crossing is stated in bytes.
    const asPlainData = <TCoin extends { nonce: string; value: bigint }>(outputs: Map<string, [TCoin, unknown]>) =>
      [...outputs.entries()].map(([commitment, [coin]]) => [commitment, coin.nonce, coin.value] as const);
    expect(asPlainData(crossed.pendingOutputs)).toEqual(asPlainData(preForkLocalState.pendingOutputs));
  });

  it('yields coins the post-fork ledger recognises as this wallet’s, by the nullifier it derives itself', () => {
    const crossed = cross(preForkBytes);
    const coin = [...crossed.coins][0];
    const nullifier = v9.coinNullifier(
      { type: coin.type, nonce: coin.nonce, value: coin.value },
      v9Mine().coinSecretKey,
    );

    expect([...crossed.removeCoinByNullifier(nullifier).coins].length).toBe([...crossed.coins].length - 1);
  });
});

describe('money built on a crossed state', () => {
  it('is accepted by the post-fork chain, and consumes its nullifier there', () => {
    // The claim that cannot be faked: a spend carries a Merkle path built from the wallet's own tree, and the ledger
    // recognises it only if that path resolves to a root the chain holds.
    const crossed = cross(preForkBytes);
    const result = spendAgainst(postForkChain, crossed, [...crossed.coins][0]);

    expect(result).toStrictEqual(Either.right(expect.anything()));

    const accepted = Either.getOrThrow(result);
    expect(Either.isLeft(attempt(() => accepted.chain.tryApply(accepted.offer)))).toBe(true);
  });

  it('would be refused from a tree rebuilt out of the wallet’s own coins alone', () => {
    // The negative control that gives the acceptance above teeth, and the shape of the mechanism this replaced: same
    // coins, same keys, same chain, only the other parties' leaves missing — so the tree the spend is built against
    // is a different tree, and the chain says so.
    const gapless = pipe(
      sourceCoins,
      EArray.reduce(new v9.ZswapLocalState(), (state, coin) =>
        state.insertCoin(v9Mine(), { type: coin.type, nonce: coin.nonce, value: coin.value }),
      ),
    );

    const refusal = spendAgainst(postForkChain, gapless, [...gapless.coins][0]);

    expect(Either.match(refusal, { onLeft: (error) => error, onRight: () => 'accepted' })).toMatch(
      /unknown coin tree root/,
    );
  });

  it('goes on working after the fork: a post-fork payment lands on top, and both coins spend', () => {
    // A crossing is only worth anything if the state keeps growing afterwards. The new commitment lands at the index
    // the pre-fork tree ended on — the exact arithmetic that wedges a wallet which arrived empty.
    const crossed = cross(preForkBytes);
    const fresh = v9.createShieldedCoinInfo(tokenType, 4_242n);
    const output = v9.ZswapOutput.new(fresh, 0, v9Mine().coinPublicKey, v9Mine().encryptionPublicKey);
    const offer = v9.ZswapOffer.fromOutput<v9.PreProof>(output, fresh.type, fresh.value);

    const grownChain = pipe(postForkChain.tryApply(offer), ([next]) => next.postBlockUpdate(new Date(2_000), 3_600n));
    const grown = crossed.apply(v9Mine(), offer);

    const newCoin = [...grown.coins].find((coin) => coin.nonce === fresh.nonce);
    expect(newCoin?.mt_index).toBe(postForkChain.firstFree);

    const carriedSpend = spendAgainst(
      grownChain,
      grown,
      [...grown.coins].find((coin) => coin.mt_index === 1n)!,
    );
    const freshSpend = spendAgainst(grownChain, grown, newCoin!);

    expect(carriedSpend).toStrictEqual(Either.right(expect.anything()));
    expect(freshSpend).toStrictEqual(Either.right(expect.anything()));
  });
});

// =============================================================================
// What the ledger guarantees about collapsed updates
// =============================================================================

/**
 * Kept from the re-anchoring suite this file replaced.
 *
 * @remarks
 *   The crossing no longer builds a tree out of collapsed updates, but they are still how every chain root in this file
 *   is read — and they are what a re-anchoring fallback would be built from, should the codec pin above ever go red
 *   before a ledger-shipped translation exists. The arithmetic is exact and the documentation of it is one sentence
 *   long ("both ends of updates _are_ included", ledger-v9.d.ts), so it is pinned rather than assumed.
 */
describe('what the ledger itself guarantees about collapsed updates', () => {
  it('takes inclusive bounds: [0, firstFree - 1] covers the whole tree, and an empty tree has no index at all', () => {
    const whole = new v9.MerkleTreeCollapsedUpdate(postForkChain, 0n, postForkChain.firstFree - 1n);

    expect(new v9.ZswapLocalState().applyCollapsedUpdate(whole).firstFree).toBe(postForkChain.firstFree);
    expect(() => new v9.MerkleTreeCollapsedUpdate(new v9.ZswapChainState(), 0n, 0n)).toThrow(/attempted update/);
    expect(() => new v9.MerkleTreeCollapsedUpdate(postForkChain, 2n, 1n)).toThrow(/end \(1\) after before \(2\)/);
  });

  it('accepts a misaligned update silently, so nothing downstream may assume the ledger checks alignment', () => {
    // Applying [1, 2] to a state whose firstFree is 0 does not throw: the local tree adopts the range and firstFree
    // jumps to end + 1, leaving a hole at index 0 that nothing complains about.
    const misaligned = new v9.ZswapLocalState().applyCollapsedUpdate(
      new v9.MerkleTreeCollapsedUpdate(postForkChain, 1n, 2n),
    );

    expect(misaligned.firstFree).toBe(3n);
  });
});

// =============================================================================
// The same question over many shapes, so the verdict is not an artefact of one layout
// =============================================================================

/** Everything one randomly-shaped fork needs: the pre-fork wallet state and the chain the fork left behind. */
const worldFor = (
  ownerships: readonly Ownership[],
): Readonly<{ preFork: v8.ZswapLocalState; postFork: v9.ZswapChainState }> => {
  const chain = pipe(
    ownerships,
    EArray.reduce({ state: new v8.ZswapChainState(), coins: [] as readonly ChainCoin[] }, (acc, owner, index) => {
      const { coin, offer } = v8Payment(owner === 'mine' ? v8Mine() : v8Theirs(), BigInt((index + 1) * 7));
      const [next, indices] = acc.state.tryApply(offer);
      return { state: next, coins: [...acc.coins, { owner, coin, offer, mtIndex: [...indices.values()][0] }] };
    }),
    (built) => ({ ...built, state: built.state.postBlockUpdate(new Date(1_000)) }),
  );

  const preFork = pipe(
    chain.coins,
    EArray.reduce(new v8.ZswapLocalState(), (state, entry) =>
      entry.owner === 'mine'
        ? state.apply(v8Mine(), entry.offer)
        : state.applyCollapsedUpdate(new v8.MerkleTreeCollapsedUpdate(chain.state, entry.mtIndex, entry.mtIndex)),
    ),
  );

  const postFork = pipe(
    chain.coins,
    EArray.reduce(new v9.ZswapChainState(), (state, entry) => {
      const keys = entry.owner === 'mine' ? v9Mine() : v9Theirs();
      const coin = { type: entry.coin.type, nonce: entry.coin.nonce, value: entry.coin.value };
      const output = v9.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey);
      const [next] = state.tryApply(v9.ZswapOffer.fromOutput<v9.PreProof>(output, coin.type, coin.value));
      return next;
    }),
    (state) => (ownerships.length === 0 ? state : state.postBlockUpdate(new Date(1_000), 3_600n)),
  );

  return { preFork, postFork };
};

describe('the crossing over many randomly shaped pre-fork trees', () => {
  it('carries coins, height and root faithfully, and its spends still validate', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom<Ownership>('mine', 'theirs'), { minLength: 0, maxLength: 12 }), (shape) => {
        const world = worldFor(shape);
        const crossed = cross(world.preFork.serialize());

        expect(flatten(crossed.coins)).toEqual(flatten(world.preFork.coins));
        expect(crossed.firstFree).toBe(world.preFork.firstFree);
        expect(Buffer.from(crossed.serialize()).equals(Buffer.from(world.preFork.serialize()))).toBe(true);

        const mine = [...crossed.coins];
        if (mine.length > 0) {
          expect(crossed.merkleTreeRoot).toBe(rootOf(world.postFork));
          expect(Either.isRight(spendAgainst(world.postFork, crossed, mine[0]))).toBe(true);
        }
      }),
      { numRuns: 20 },
    );
  });
});
