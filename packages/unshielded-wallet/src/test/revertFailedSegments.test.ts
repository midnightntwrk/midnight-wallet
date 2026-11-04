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
 * Releasing the coins of a partially successful transaction's failed segments, through the forking wallet an
 * application holds.
 *
 * @remarks
 *   A partial success applied segment 0, where every guaranteed offer runs, and every fallible segment it does not list
 *   as failed. So `revertFailedSegments(tx, [s])` must return to the available set exactly the wallet's own coins that
 *   the fallible offer of segment `s` spent, and leave the coins the guaranteed offer spent booked: those are gone on
 *   chain, and offering them again would build a transaction the ledger rejects.
 *
 *   The forking wallet dispatches the call to whichever variant is running, and that variant hands the failed segments on
 *   to its transacting capability, so each side of the boundary is pinned here: a dispatch arm that dropped the call,
 *   or a variant that lost the segments on the way down, would leave the failed segment's coin booked on that side
 *   only.
 *
 *   The bookings are the real ones: `rotateUtxos`, called through the wallet's own API, builds a single intent at segment
 *   1 with one coin in its guaranteed offer and one in its fallible offer, and books both.
 */

import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { Effect, identity, type Scope } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import { type UnshieldedWalletState } from '../UnshieldedWalletAPI.js';
import { V1Tag } from '../v1/RunningV1Variant.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import { type ForkWallet, makeForkWallet } from './forkHarness.js';
import { timelineTransaction, v2Identity } from './forkTimeline.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its V2 variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has not forked — a version the V1 variant owns. */
const v8Version = 5;
/** A chain that has — past the boundary rather than exactly at it. */
const v9Version = 9;

const owner = v2Identity(networkId);

/** Far enough ahead that nothing here expires, so expiry cannot be what releases a booking. */
const ttl = new Date(2_000_000_000_000);

/** The value of the coin spent in the guaranteed offer, which runs in segment 0. */
const guaranteedValue = 100n;
/** The value of the coin spent in the fallible offer of segment 1. */
const fallibleValue = 200n;

/** The segment the single intent `rotateUtxos` builds sits at, and so the segment its fallible offer runs in. */
const fallibleSegment = 1;

/** A chain sitting on one side of the boundary: two coins, every message reported at the same version. */
const chainAt = (protocolVersion: number) => [
  timelineTransaction({ id: 1, protocolVersion, owner: owner.addressHex, value: guaranteedValue }),
  timelineTransaction({ id: 2, protocolVersion, owner: owner.addressHex, value: fallibleValue }),
];

/** A probe answering as a chain on `version` would, so the wallet starts on the variant that owns it. */
const chainReporting =
  (version: number): ChainVersionProbe =>
  () =>
    Promise.resolve(ProtocolVersion.ProtocolVersion(BigInt(version)));

/** The wallet's current state, as its public API projects it. */
const publicState = (wallet: ForkWallet['unshielded']): Effect.Effect<UnshieldedWalletState> =>
  Effect.promise(() => rx.firstValueFrom(wallet.state));

const sortedValues = (coins: UnshieldedWalletState['availableCoins']): readonly bigint[] =>
  coins.map(({ utxo }) => utxo.value).toSorted((a, b) => Number(a - b));

/** A started wallet on a chain at `protocolVersion`, synced to its end, holding both coins available. */
const syncedWallet = (protocolVersion: number): Effect.Effect<ForkWallet, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wallet = yield* makeForkWallet({
      timeline: chainAt(protocolVersion),
      forkVersion,
      publicKey: owner,
      chainVersionProbe: chainReporting(protocolVersion),
    });
    yield* Effect.addFinalizer(() => wallet.stop);

    const settled = yield* Effect.fork(wallet.awaitState((state) => state.state.progress.appliedId === 2n));
    yield* wallet.start;
    yield* settled.await.pipe(Effect.flatMap(identity), Effect.orDie);
    return wallet;
  });

/**
 * The claim, made of whichever variant `wallet` is running: once segment 1 is reported failed, the coin its fallible
 * offer spent is available again and the coin the guaranteed offer spent stays booked.
 */
const releasesOnlyTheFailedSegmentsCoin = (wallet: ForkWallet) =>
  Effect.gen(function* () {
    const synced = yield* publicState(wallet.unshielded);
    const guaranteedCoin = synced.availableCoins.find(({ utxo }) => utxo.value === guaranteedValue);
    const fallibleCoin = synced.availableCoins.find(({ utxo }) => utxo.value === fallibleValue);
    expect(guaranteedCoin).toBeDefined();
    expect(fallibleCoin).toBeDefined();

    const transaction = yield* Effect.promise(() =>
      wallet.unshielded.rotateUtxos([guaranteedCoin!], [fallibleCoin!], synced.verifyingKey, ttl),
    );

    const booked = yield* publicState(wallet.unshielded);
    // The premise, asserted rather than assumed: the build booked both coins, leaving nothing available.
    expect(sortedValues(booked.pendingCoins)).toEqual([guaranteedValue, fallibleValue]);
    expect(sortedValues(booked.availableCoins)).toEqual([]);

    yield* Effect.promise(() => wallet.unshielded.revertFailedSegments(transaction, [fallibleSegment]));
    const reverted = yield* publicState(wallet.unshielded);

    expect(sortedValues(reverted.availableCoins)).toEqual([fallibleValue]);
    expect(sortedValues(reverted.pendingCoins)).toEqual([guaranteedValue]);
  });

describe('an unshielded wallet releasing the coins of a transaction’s failed segments', () => {
  it('should make the coin a failed fallible segment spent available again and keep the guaranteed coin booked on the V1 variant, because segment 0 was applied', async () =>
    Effect.gen(function* () {
      const wallet = yield* syncedWallet(v8Version);
      expect(yield* wallet.activeTag).toBe(V1Tag);

      yield* releasesOnlyTheFailedSegmentsCoin(wallet);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should make the coin a failed fallible segment spent available again and keep the guaranteed coin booked on the V2 variant, because segment 0 was applied', async () =>
    Effect.gen(function* () {
      const wallet = yield* syncedWallet(v9Version);
      expect(yield* wallet.activeTag).toBe(V2Tag);

      yield* releasesOnlyTheFailedSegmentsCoin(wallet);
    }).pipe(Effect.scoped, Effect.runPromise));
});
