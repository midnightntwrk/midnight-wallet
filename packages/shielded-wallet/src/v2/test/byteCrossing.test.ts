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
 *   `Migration.makeCrossLedgerMigration` carries a shielded wallet across a hard fork by handing ledger-v8's serialized
 *   local state to ledger-v9's deserializer. That is the whole mechanism, and it is only sound because the fork did not
 *   move this particular codec: the transaction codec did move at this boundary, `zswap-local-state` did not. Nothing
 *   in either `.d.ts` states that, and neither offers a version-parameterised `deserialize`, so it is pinned here —
 *   against both real ledger modules, with no stubs anywhere in the file.
 *
 *   **If this file goes red, a ledger major has moved the local-state codec.** The failure will be loud: a header-tag
 *   mismatch thrown out of `deserialize`, which the migration turns into a `WalletError` rather than letting it escape.
 *   The fix is not to work around it here — it is to ask the ledger team for a local-state translation and install it
 *   in the `StateMigration` seam, exactly as the chain's own `LedgerState` translation is installed. Re-deriving the
 *   wallet from its spendable coins is _not_ an acceptable substitute: it silently drops `pendingOutputs`, the coins a
 *   wallet is owed but has not yet seen on chain, which no chain re-announces after a fork.
 *
 *   The world under test is real on both sides. A ledger-v8 chain is built with this wallet's coins interleaved between
 *   another party's, a ledger-v8 local state is grown against it exactly as a syncing wallet grows one, and the
 *   ledger-v9 chain is `translationStub`'s construction: re-paying the same coins to the same public keys reproduces
 *   the ledger-v8 commitments, because a commitment is a function of the coin and its owner alone.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
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
// The ledger-v8 world
// =============================================================================

const mySeed = Buffer.alloc(32, 3);
const theirSeed = Buffer.alloc(32, 4);

const v8Mine = (): ledgerV8.ZswapSecretKeys => ledgerV8.ZswapSecretKeys.fromSeed(mySeed);
const v8Theirs = (): ledgerV8.ZswapSecretKeys => ledgerV8.ZswapSecretKeys.fromSeed(theirSeed);
const v9Mine = (): ledgerV9.ZswapSecretKeys => ledgerV9.ZswapSecretKeys.fromSeed(mySeed);
const v9Theirs = (): ledgerV9.ZswapSecretKeys => ledgerV9.ZswapSecretKeys.fromSeed(theirSeed);

type Ownership = 'mine' | 'theirs';

/** This wallet's coins at Merkle indices 1 and 4, with somebody else's around and between them. */
const layout: readonly Ownership[] = ['theirs', 'mine', 'theirs', 'theirs', 'mine', 'theirs'];

type ChainCoin = Readonly<{
  owner: Ownership;
  coin: ledgerV8.ShieldedCoinInfo;
  offer: ledgerV8.ZswapOffer<ledgerV8.PreProof>;
  mtIndex: bigint;
}>;

const tokenType = ledgerV8.shieldedToken().raw;

const v8Payment = (
  keys: ledgerV8.ZswapSecretKeys,
  value: bigint,
): Readonly<{ coin: ledgerV8.ShieldedCoinInfo; offer: ledgerV8.ZswapOffer<ledgerV8.PreProof> }> => {
  const coin = ledgerV8.createShieldedCoinInfo(tokenType, value);
  const output = ledgerV8.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey);
  return { coin, offer: ledgerV8.ZswapOffer.fromOutput<ledgerV8.PreProof>(output, coin.type, coin.value) };
};

/** The ledger-v8 chain, one commitment per offer, rehashed at the end so collapsed updates can be cut from it. */
const v8Chain = pipe(
  layout,
  EArray.reduce({ state: new ledgerV8.ZswapChainState(), coins: [] as readonly ChainCoin[] }, (acc, owner, index) => {
    const { coin, offer } = v8Payment(owner === 'mine' ? v8Mine() : v8Theirs(), BigInt((index + 1) * 100));
    const [nextState, indices] = acc.state.tryApply(offer);
    return { state: nextState, coins: [...acc.coins, { owner, coin, offer, mtIndex: [...indices.values()][0] }] };
  }),
  (built) => ({ ...built, state: built.state.postBlockUpdate(new Date(1_000)) }),
);

/** A coin this wallet is told to expect but has not seen on chain: content for `pendingOutputs`. */
const watched = ledgerV8.createShieldedCoinInfo(tokenType, 777n);

/**
 * The V1 wallet's own local state, grown exactly as a syncing wallet grows one.
 *
 * @remarks
 *   Its own offers applied for the indices it owns, collapsed updates for everybody else's, walked in Merkle-index order
 *   — so the tree is the chain's tree and the coins sit where the chain put them.
 */
const v8LocalState = pipe(
  v8Chain.coins,
  EArray.reduce(new ledgerV8.ZswapLocalState(), (state, entry) =>
    entry.owner === 'mine'
      ? state.apply(v8Mine(), entry.offer)
      : state.applyCollapsedUpdate(new ledgerV8.MerkleTreeCollapsedUpdate(v8Chain.state, entry.mtIndex, entry.mtIndex)),
  ),
  (state) => state.watchFor(v8Mine().coinPublicKey, watched),
);

const v8Bytes = v8LocalState.serialize();
const sourceCoins = flatten(v8LocalState.coins);

// =============================================================================
// The ledger-v9 world: the chain the fork left behind
// =============================================================================

/**
 * The ledger-v9 chain, holding the ledger-v8 commitments.
 *
 * @remarks
 *   The translation stub's construction (`src/test/translationStub.ts`), inlined here so this file depends on nothing but
 *   the two ledgers: re-pay each ledger-v8 coin — same token type, same nonce, same value, same recipient — in the same
 *   order on a fresh chain of ledger-v9.
 */
const v9Chain = pipe(
  v8Chain.coins,
  EArray.reduce(new ledgerV9.ZswapChainState(), (state, entry) => {
    const keys = entry.owner === 'mine' ? v9Mine() : v9Theirs();
    const coin = { type: entry.coin.type, nonce: entry.coin.nonce, value: entry.coin.value };
    const output = ledgerV9.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey);
    const [next] = state.tryApply(ledgerV9.ZswapOffer.fromOutput<ledgerV9.PreProof>(output, coin.type, coin.value));
    return next;
  }),
  (state) => state.postBlockUpdate(new Date(1_000), 3_600n),
);

/** The Merkle root of a chain's tree, read through a local state — a chain state does not expose one. */
const rootOf = (chain: ledgerV9.ZswapChainState): bigint | undefined =>
  chain.firstFree === 0n
    ? new ledgerV9.ZswapLocalState().merkleTreeRoot
    : new ledgerV9.ZswapLocalState().applyCollapsedUpdate(
        new ledgerV9.MerkleTreeCollapsedUpdate(chain, 0n, chain.firstFree - 1n),
      ).merkleTreeRoot;

/** Builds a spend of `coin` off `state` and offers it to `chain`. */
const spendAgainst = (
  chain: ledgerV9.ZswapChainState,
  state: ledgerV9.ZswapLocalState,
  coin: ledgerV9.QualifiedShieldedCoinInfo,
): Either.Either<
  Readonly<{ chain: ledgerV9.ZswapChainState; offer: ledgerV9.ZswapOffer<ledgerV9.PreProof> }>,
  string
> =>
  attempt(() => {
    const [, input] = state.spend(v9Mine(), coin, 0);
    const offer = ledgerV9.ZswapOffer.fromInput(input, coin.type, coin.value);
    const [applied] = chain.tryApply(offer);
    return { chain: applied, offer };
  });

// =============================================================================
// The crossing under test
// =============================================================================

const cross = (bytes: Uint8Array): ledgerV9.ZswapLocalState => ledgerV9.ZswapLocalState.deserialize(bytes);

describe('the codec the cross-fork migration rests on', () => {
  it('is the same one on both sides of the boundary, down to the header tag', () => {
    // The tags are compared as legible strings, not as byte arrays, so that a failure names both of them and says
    // straight away which major moved and to what.
    const tagOf = (bytes: Uint8Array): string => asAscii(bytes, 34);

    expect(tagOf(new ledgerV9.ZswapLocalState().serialize())).toBe(tagOf(new ledgerV8.ZswapLocalState().serialize()));
    expect(tagOf(new ledgerV8.ZswapLocalState().serialize())).toContain('zswap-local-state');

    // And the whole empty serialization, not merely its header: nothing else in the encoding drifted either.
    expect(
      Buffer.from(new ledgerV9.ZswapLocalState().serialize()).equals(
        Buffer.from(new ledgerV8.ZswapLocalState().serialize()),
      ),
    ).toBe(true);
  });

  it('does not extend to transactions, which is what makes this a claim about local state and not about the fork', () => {
    // The control that stops the test above being read as "the fork changed nothing". It changed the transaction
    // codec; local state is the exception, and that exception is precisely what the migration exploits.
    const tagOf = (bytes: Uint8Array): string => asAscii(bytes, 34);
    const v8Tag = tagOf(ledgerV8.Transaction.fromParts('undeployed', v8Chain.coins[1].offer).eraseProofs().serialize());
    const v9Output = ledgerV9.ZswapOutput.new(
      { type: tokenType, nonce: watched.nonce, value: watched.value },
      0,
      v9Mine().coinPublicKey,
      v9Mine().encryptionPublicKey,
    );
    const v9Tag = tagOf(
      ledgerV9.Transaction.fromParts(
        'undeployed',
        ledgerV9.ZswapOffer.fromOutput<ledgerV9.PreProof>(v9Output, tokenType, watched.value),
      )
        .eraseProofs()
        .serialize(),
    );

    expect(v9Tag).not.toBe(v8Tag);
  });
});

describe('a ledger-v8 local state read by ledger-v9', () => {
  it('decodes, and re-serializes to the very bytes it came from', () => {
    const crossed = cross(v8Bytes);

    expect(Buffer.from(crossed.serialize()).equals(Buffer.from(v8Bytes))).toBe(true);
  });

  it('says everything the source said: coins, height, root, and the outputs still expected', () => {
    const crossed = cross(v8Bytes);

    // The premise, read off the source rather than assumed: two coins at indices 1 and 4, in a tree six leaves tall,
    // with one output outstanding.
    expect(sourceCoins.map((coin) => coin.mtIndex)).toEqual([1n, 4n]);
    expect(v8LocalState.firstFree).toBe(6n);
    expect(v8LocalState.pendingOutputs.size).toBe(1);

    expect(flatten(crossed.coins)).toEqual(sourceCoins);
    expect(crossed.firstFree).toBe(v8LocalState.firstFree);
    // The single number that says this is the same tree and not merely a tree with the same leaves the wallet owns.
    expect(crossed.merkleTreeRoot).toBe(rootOf(v9Chain));

    // `pendingOutputs` compared by content, not by count. This is the member a reconstruction from spendable coins
    // silently loses, so it is the reason the crossing is stated in bytes.
    const asPlainData = <TCoin extends { nonce: string; value: bigint }>(outputs: Map<string, [TCoin, unknown]>) =>
      [...outputs.entries()].map(([commitment, [coin]]) => [commitment, coin.nonce, coin.value] as const);
    expect(asPlainData(crossed.pendingOutputs)).toEqual(asPlainData(v8LocalState.pendingOutputs));
  });

  it('yields coins ledger-v9 recognises as this wallet’s, by the nullifier it derives itself', () => {
    const crossed = cross(v8Bytes);
    const coin = [...crossed.coins][0];
    const nullifier = ledgerV9.coinNullifier(
      { type: coin.type, nonce: coin.nonce, value: coin.value },
      v9Mine().coinSecretKey,
    );

    expect([...crossed.removeCoinByNullifier(nullifier).coins].length).toBe([...crossed.coins].length - 1);
  });
});

describe('money built on a crossed state', () => {
  it('is accepted by the ledger-v9 chain, and consumes its nullifier there', () => {
    // The claim that cannot be faked: a spend carries a Merkle path built from the wallet's own tree, and the ledger
    // recognises it only if that path resolves to a root the chain holds.
    const crossed = cross(v8Bytes);
    const result = spendAgainst(v9Chain, crossed, [...crossed.coins][0]);

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
      EArray.reduce(new ledgerV9.ZswapLocalState(), (state, coin) =>
        state.insertCoin(v9Mine(), { type: coin.type, nonce: coin.nonce, value: coin.value }),
      ),
    );

    const refusal = spendAgainst(v9Chain, gapless, [...gapless.coins][0]);

    expect(Either.match(refusal, { onLeft: (error) => error, onRight: () => 'accepted' })).toMatch(
      /unknown coin tree root/,
    );
  });

  it('goes on working after the v9 fork: a ledger-v9 payment lands on top, and both coins spend', () => {
    // A crossing is only worth anything if the state keeps growing afterwards. The new commitment lands at the index
    // the ledger-v8 tree ended on — the exact arithmetic that wedges a wallet which arrived empty.
    const crossed = cross(v8Bytes);
    const fresh = ledgerV9.createShieldedCoinInfo(tokenType, 4_242n);
    const output = ledgerV9.ZswapOutput.new(fresh, 0, v9Mine().coinPublicKey, v9Mine().encryptionPublicKey);
    const offer = ledgerV9.ZswapOffer.fromOutput<ledgerV9.PreProof>(output, fresh.type, fresh.value);

    const grownChain = pipe(v9Chain.tryApply(offer), ([next]) => next.postBlockUpdate(new Date(2_000), 3_600n));
    const grown = crossed.apply(v9Mine(), offer);

    const newCoin = [...grown.coins].find((coin) => coin.nonce === fresh.nonce);
    expect(newCoin?.mt_index).toBe(v9Chain.firstFree);

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
 *   long ("both ends of updates _are_ included", ledger-ledgerV9.d.ts), so it is pinned rather than assumed.
 */
describe('what the ledger itself guarantees about collapsed updates', () => {
  it('takes inclusive bounds: [0, firstFree - 1] covers the whole tree, and an empty tree has no index at all', () => {
    const whole = new ledgerV9.MerkleTreeCollapsedUpdate(v9Chain, 0n, v9Chain.firstFree - 1n);

    expect(new ledgerV9.ZswapLocalState().applyCollapsedUpdate(whole).firstFree).toBe(v9Chain.firstFree);
    expect(() => new ledgerV9.MerkleTreeCollapsedUpdate(new ledgerV9.ZswapChainState(), 0n, 0n)).toThrow(
      /attempted update/,
    );
    expect(() => new ledgerV9.MerkleTreeCollapsedUpdate(v9Chain, 2n, 1n)).toThrow(/end \(1\) after before \(2\)/);
  });

  it('accepts a misaligned update silently, so nothing downstream may assume the ledger checks alignment', () => {
    // Applying [1, 2] to a state whose firstFree is 0 does not throw: the local tree adopts the range and firstFree
    // jumps to end + 1, leaving a hole at index 0 that nothing complains about.
    const misaligned = new ledgerV9.ZswapLocalState().applyCollapsedUpdate(
      new ledgerV9.MerkleTreeCollapsedUpdate(v9Chain, 1n, 2n),
    );

    expect(misaligned.firstFree).toBe(3n);
  });
});

// =============================================================================
// The same question over many shapes, so the verdict is not an artefact of one layout
// =============================================================================

/** Everything one randomly-shaped fork needs: the V1 wallet state and the chain the fork left behind. */
const worldFor = (
  ownerships: readonly Ownership[],
): Readonly<{ v8: ledgerV8.ZswapLocalState; v9: ledgerV9.ZswapChainState }> => {
  const chain = pipe(
    ownerships,
    EArray.reduce({ state: new ledgerV8.ZswapChainState(), coins: [] as readonly ChainCoin[] }, (acc, owner, index) => {
      const { coin, offer } = v8Payment(owner === 'mine' ? v8Mine() : v8Theirs(), BigInt((index + 1) * 7));
      const [next, indices] = acc.state.tryApply(offer);
      return { state: next, coins: [...acc.coins, { owner, coin, offer, mtIndex: [...indices.values()][0] }] };
    }),
    (built) => ({ ...built, state: built.state.postBlockUpdate(new Date(1_000)) }),
  );

  const v8 = pipe(
    chain.coins,
    EArray.reduce(new ledgerV8.ZswapLocalState(), (state, entry) =>
      entry.owner === 'mine'
        ? state.apply(v8Mine(), entry.offer)
        : state.applyCollapsedUpdate(new ledgerV8.MerkleTreeCollapsedUpdate(chain.state, entry.mtIndex, entry.mtIndex)),
    ),
  );

  const v9 = pipe(
    chain.coins,
    EArray.reduce(new ledgerV9.ZswapChainState(), (state, entry) => {
      const keys = entry.owner === 'mine' ? v9Mine() : v9Theirs();
      const coin = { type: entry.coin.type, nonce: entry.coin.nonce, value: entry.coin.value };
      const output = ledgerV9.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey);
      const [next] = state.tryApply(ledgerV9.ZswapOffer.fromOutput<ledgerV9.PreProof>(output, coin.type, coin.value));
      return next;
    }),
    (state) => (ownerships.length === 0 ? state : state.postBlockUpdate(new Date(1_000), 3_600n)),
  );

  return { v8, v9 };
};

describe('the crossing over many randomly shaped ledger-v8 trees', () => {
  it('carries coins, height and root faithfully, and its spends still validate', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom<Ownership>('mine', 'theirs'), { minLength: 0, maxLength: 12 }), (shape) => {
        const world = worldFor(shape);
        const crossed = cross(world.v8.serialize());

        expect(flatten(crossed.coins)).toEqual(flatten(world.v8.coins));
        expect(crossed.firstFree).toBe(world.v8.firstFree);
        expect(Buffer.from(crossed.serialize()).equals(Buffer.from(world.v8.serialize()))).toBe(true);

        const mine = [...crossed.coins];
        if (mine.length > 0) {
          expect(crossed.merkleTreeRoot).toBe(rootOf(world.v9));
          expect(Either.isRight(spendAgainst(world.v9, crossed, mine[0]))).toBe(true);
        }
      }),
      { numRuns: 20 },
    );
  });
});
