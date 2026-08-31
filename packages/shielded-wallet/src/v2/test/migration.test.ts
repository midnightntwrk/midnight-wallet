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
 * How this variant builds its first state from whatever preceded it.
 *
 * @remarks
 *   The three strategies differ in exactly one thing — how much of the previous wallet is allowed to survive — so that is
 *   what these pin down: everything (same ledger version), nothing (no previous wallet at all), and, across a ledger
 *   version boundary, everything again, because the local state crosses as bytes.
 *
 *   The previous wallet here is a real `@midnight-ntwrk/ledger-v8` one, grown against a real pre-fork chain. Nothing
 *   about the crossing can be checked against a hand-written stand-in: what is under test is whether one ledger
 *   version's serialization is something the other can read, and only the two modules themselves can answer that.
 *   `byteCrossing.test.ts` is where that codec is characterized; this file is about what the migration does with it.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion, type SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import { LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Array as EArray, Cause, Effect, Exit, Option, Order, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoinHashesMap, CoreWallet, PublicKeys } from '../CoreWallet.js';
import {
  type PreviousLedgerWallet,
  makeCarryOverMigration,
  makeCrossLedgerMigration,
  makeEmptyWalletMigration,
} from '../Migration.js';

const networkId = NetworkId.NetworkId.Undeployed;
const seed = Buffer.alloc(32, 7);
const keys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(seed);
const v8Keys = (): v8.ZswapSecretKeys => v8.ZswapSecretKeys.fromSeed(seed);
const strangerV8Keys = (): v8.ZswapSecretKeys => v8.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 8));

/** The version that triggered the hand-over: the first one the previous variant saw outside its own range. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);

const parkedProgress: SyncProgress.SyncProgressData = {
  appliedIndex: 4321n,
  highestRelevantWalletIndex: 4400n,
  highestIndex: 4400n,
  highestRelevantIndex: 4400n,
  isConnected: true,
};

/** Pays a fresh coin of `value` to `recipient`: one output, therefore one commitment, therefore one Merkle index. */
const v8Payment = (
  recipient: v8.ZswapSecretKeys,
  value: bigint,
): Readonly<{ coin: v8.ShieldedCoinInfo; offer: v8.ZswapOffer<v8.PreProof> }> => {
  const coin = v8.createShieldedCoinInfo(v8.shieldedToken().raw, value);
  const output = v8.ZswapOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
  return { coin, offer: v8.ZswapOffer.fromOutput<v8.PreProof>(output, coin.type, coin.value) };
};

/**
 * A real pre-fork wallet state: two of this wallet's coins around a stranger's, and one output still expected.
 *
 * @remarks
 *   The stranger's coin is what makes the tree taller than the coins in it, so a crossing that kept only what the wallet
 *   owns would land the second coin at the wrong Merkle index. The watched coin is content for `pendingOutputs`: a
 *   commitment the wallet knows and a leaf that is not on chain, which nothing on the far side of a fork announces.
 */
const preForkState = (): v8.ZswapLocalState => {
  const mine = v8Keys();
  // One offer applied at a time, rather than one merged offer: merging leaves the within-offer ordering to the ledger,
  // and the Merkle indices are half of what this file is about.
  return pipe(
    [v8Payment(mine, 100n), v8Payment(strangerV8Keys(), 999n), v8Payment(mine, 200n)],
    EArray.reduce(new v8.ZswapLocalState(), (state, payment) => state.apply(mine, payment.offer)),
    (state) => state.watchFor(mine.coinPublicKey, v8.createShieldedCoinInfo(v8.shieldedToken().raw, 777n)),
  );
};

/** A wallet of the previous ledger version, as the runtime hands one over. */
const previousWallet = (state: PreviousLedgerWallet['state'] = preForkState()): PreviousLedgerWallet => {
  const secretKeys = v8Keys();
  return {
    publicKeys: {
      coinPublicKey: secretKeys.coinPublicKey,
      encryptionPublicKey: secretKeys.encryptionPublicKey,
    },
    networkId,
    protocolVersion: forkVersion,
    progress: parkedProgress,
    state,
  };
};

/** Coins as plain comparable data, ascending by Merkle index, whichever ledger version holds them. */
const flatten = (
  coins: Iterable<{ type: string; nonce: string; value: bigint; mt_index: bigint }>,
): readonly Readonly<{ type: string; nonce: string; value: bigint; mtIndex: bigint }>[] =>
  pipe(
    [...coins],
    EArray.map((coin) => ({ type: coin.type, nonce: coin.nonce, value: coin.value, mtIndex: coin.mt_index })),
    EArray.sort(Order.mapInput(Order.bigint, (coin: { mtIndex: bigint }) => coin.mtIndex)),
  );

/** The outputs a state is still expecting, as plain comparable data, whichever ledger version holds them. */
const expectedOutputs = <TCoin extends { nonce: string; value: bigint }>(state: {
  readonly pendingOutputs: Map<string, [TCoin, Date | undefined]>;
}): readonly (readonly [string, string, bigint])[] =>
  [...state.pendingOutputs.entries()].map(([commitment, [coin]]) => [commitment, coin.nonce, coin.value] as const);

const crossed = (previous: PreviousLedgerWallet = previousWallet()): Promise<CoreWallet> =>
  Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

describe('the empty-wallet migration', () => {
  it('produces a wallet with no coins on the configured network', async () => {
    const wallet = await Effect.runPromise(makeEmptyWalletMigration({ networkId }).migrate(null));

    expect(wallet.networkId).toBe(networkId);
    expect([...wallet.state.coins]).toEqual([]);
    expect(wallet.coinHashes).toEqual({});
    expect(wallet.progress.appliedIndex).toBe(0n);
    expect(wallet.protocolVersion).toBe(ProtocolVersion.MinSupportedVersion);
  });
});

describe('the carry-over migration', () => {
  it('hands the previous state through untouched', async () => {
    const previous = CoreWallet.init(new ledger.ZswapLocalState(), keys(), networkId);

    const wallet = await Effect.runPromise(makeCarryOverMigration().migrate(previous));

    expect(wallet).toBe(previous);
  });
});

describe('the cross-ledger migration', () => {
  it('carries the public keys, so the same identity owns the crossed coins on the far side', async () => {
    const wallet = await crossed();

    // The two ledger versions derive identical public keys from one seed, which is what lets the crossed state be
    // this wallet's on both sides of the boundary.
    expect(wallet.publicKeys).toEqual(PublicKeys.fromSecretKeys(keys()));
    expect(wallet.networkId).toBe(networkId);
  });

  it('records the version that triggered the hand-over, so the new variant starts inside its own range', async () => {
    const wallet = await crossed();

    expect(wallet.protocolVersion).toBe(forkVersion);
  });

  it('brings the whole local state across: coins at their indices, and the height the tree had reached', async () => {
    const source = preForkState();
    const wallet = await crossed(previousWallet(source));

    // The premise, read off the pre-fork state itself rather than assumed: two coins, at indices 0 and 2 because a
    // stranger's commitment sits between them, in a tree three leaves tall.
    expect(flatten(source.coins).map((coin) => coin.mtIndex)).toEqual([0n, 2n]);
    expect(source.firstFree).toBe(3n);

    expect(flatten(wallet.state.coins)).toEqual(flatten(source.coins));
    expect(wallet.state.firstFree).toBe(source.firstFree);
    // The single number that says this is the same tree and not merely a tree with the same leaves: the stranger's
    // commitment crossed too, or the root would differ.
    expect(wallet.state.merkleTreeRoot).toBe(source.merkleTreeRoot);
  });

  it('brings the outputs the wallet was still expecting, which no chain announces twice', async () => {
    const source = preForkState();
    const wallet = await crossed(previousWallet(source));

    expect(expectedOutputs(source).length).toBe(1);
    expect(expectedOutputs(wallet.state)).toEqual(expectedOutputs(source));
  });

  it('leaves the coin hashes to be computed, and says so', async () => {
    // Commitments and nullifiers are derived from the secret keys, and a migration is handed none: it reads a state
    // off the previous variant, not key material. So the map is empty and the wallet declares why — the first sync
    // update, which does carry keys, is what fills it in.
    const wallet = await crossed();

    expect(wallet.coinHashes).toEqual(CoinHashesMap.empty);
    expect(wallet.coinHashesPending).toBe(true);
  });

  it('parks sync progress at the fork, because event ids continue across it rather than restarting', async () => {
    // The confirmed semantics: a hard fork does not restart the timeline. The indexer numbers events onwards from
    // whatever id it had reached when the fork happened — never from zero — so the migrated wallet resumes from where
    // its predecessor stopped. Rewinding to zero would point it at a stretch of the timeline this ledger version's
    // events do not occupy, and it would sit there waiting for ones that already went by.
    const previous = previousWallet();
    expect(previous.progress.appliedIndex).toBeGreaterThan(0n);

    const wallet = await crossed(previous);

    expect(wallet.progress.appliedIndex).toBe(previous.progress.appliedIndex);
    expect(wallet.progress.highestIndex).toBe(previous.progress.highestIndex);
    expect(wallet.progress.highestRelevantIndex).toBe(previous.progress.highestRelevantIndex);
    expect(wallet.progress.highestRelevantWalletIndex).toBe(previous.progress.highestRelevantWalletIndex);
    // The position crosses; being connected does not. This state has no running sync behind it yet — the restart that
    // follows the migration is what reconnects it — and claiming otherwise would report a gap that nothing is closing.
    expect(previous.progress.isConnected).toBe(true);
    expect(wallet.progress.isConnected).toBe(false);
  });

  it('fails with a wallet error, rather than throwing, when the bytes are not a state this version can read', async () => {
    // The failure mode of a future ledger major moving the `zswap-local-state` codec, and the reason the crossing is
    // read through `LedgerOps.ledgerTry`: it surfaces here, at the seam a ledger-shipped translation would be
    // installed into, instead of escaping a migration the runtime expects to be total.
    const unreadable = await Effect.runPromiseExit(
      makeCrossLedgerMigration().migrate(previousWallet({ serialize: () => new Uint8Array([1, 2, 3]) })),
    );

    expect(Exit.isFailure(unreadable)).toBe(true);
    const failure = Exit.isFailure(unreadable) ? Cause.failureOption(unreadable.cause) : Option.none();
    expect(Option.getOrThrow(failure)).toBeInstanceOf(LedgerOps.LedgerError);
  });
});
