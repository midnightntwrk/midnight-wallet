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
 * Releasing booked coins by id, through the forking wallet an application holds.
 *
 * @remarks
 *   `revertUtxos` is the release for a caller that kept only the ids of the coins it booked, not the transaction that
 *   booked them. The forking wallet dispatches it to whichever variant is running, so each side of the boundary is
 *   pinned here: a dispatch arm that dropped the call, or a variant that ignored it, would leave the coins booked on
 *   that side only.
 *
 *   The bookings are the real ones: a transfer built through the wallet's own API, which moves the inputs coin selection
 *   picked out of the available set and into the pending one.
 */

import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { Effect, identity, type Scope } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import { V1Tag } from '../v1/RunningV1Variant.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import { bookedUtxosOf, type CarriedUtxo, type ForkWallet, makeForkWallet, utxosOf } from './forkHarness.js';
import { timelineTokenType, timelineTransaction, v2Identity } from './forkTimeline.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its V2 variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has not forked — a version the V1 variant owns. */
const v8Version = 5;
/** A chain that has — past the boundary rather than exactly at it. */
const v9Version = 9;

const owner = v2Identity(networkId);

/** Somebody else's address, so a transfer really takes value out of the wallet. */
const stranger = new UnshieldedAddress(Buffer.alloc(32, 7));

/** Far enough ahead that nothing here expires. */
const ttl = new Date(2_000_000_000_000);

/** More than any two of the wallet's three coins cover, so the transfer books all three. */
const transferAmount = 550n;

/** A chain sitting on one side of the boundary: three coins, every message reported at the same version. */
const chainAt = (protocolVersion: number) => [
  timelineTransaction({ id: 1, protocolVersion, owner: owner.addressHex, value: 100n }),
  timelineTransaction({ id: 2, protocolVersion, owner: owner.addressHex, value: 200n }),
  timelineTransaction({ id: 3, protocolVersion, owner: owner.addressHex, value: 300n }),
];

/** A probe answering as a chain on `version` would, so the wallet starts on the variant that owns it. */
const chainReporting =
  (version: number): ChainVersionProbe =>
  () =>
    Promise.resolve(ProtocolVersion.ProtocolVersion(BigInt(version)));

const valuesOf = (utxos: readonly CarriedUtxo[]): readonly bigint[] => utxos.map((u) => u.value);

/** The id a coin is booked under, as `revertUtxos` names it. */
const idOf = (utxo: CarriedUtxo): string => `${utxo.intentHash}#${utxo.outputNo}`;

/** The wallet's current state, as its public API projects it. */
const publicState = (wallet: ForkWallet['unshielded']) => Effect.promise(() => rx.firstValueFrom(wallet.state));

/** A started wallet on a chain at `protocolVersion`, synced to its end, with a transfer booking all three coins. */
const walletWithEverythingBooked = (protocolVersion: number): Effect.Effect<ForkWallet, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wallet = yield* makeForkWallet({
      timeline: chainAt(protocolVersion),
      forkVersion,
      publicKey: owner,
      chainVersionProbe: chainReporting(protocolVersion),
    });
    yield* Effect.addFinalizer(() => wallet.stop);

    const settled = yield* Effect.fork(wallet.awaitState((state) => state.state.progress.appliedId === 3n));
    yield* wallet.start;
    yield* settled.await.pipe(Effect.flatMap(identity), Effect.orDie);

    yield* Effect.promise(() =>
      wallet.unshielded.transferTransaction(
        [{ amount: transferAmount, type: timelineTokenType, receiverAddress: stranger }],
        ttl,
      ),
    );
    return wallet;
  });

/**
 * The claim, made of whichever variant `wallet` is running: an id that is not booked changes nothing, and a booked id
 * returns exactly that coin to the available set while the others stay booked.
 */
const releasesOnlyTheNamedBookedCoin = (wallet: ForkWallet) =>
  Effect.gen(function* () {
    const booked = yield* publicState(wallet.unshielded);
    // The premise, asserted rather than assumed: the transfer booked every coin, leaving nothing available.
    expect(valuesOf(bookedUtxosOf(booked.state))).toEqual([100n, 200n, 300n]);
    expect(valuesOf(utxosOf(booked.state))).toEqual([]);

    yield* Effect.promise(() => wallet.unshielded.revertUtxos([`${'f'.repeat(64)}#0`]));
    const afterUnknown = yield* publicState(wallet.unshielded);
    expect(bookedUtxosOf(afterUnknown.state)).toEqual(bookedUtxosOf(booked.state));
    expect(utxosOf(afterUnknown.state)).toEqual([]);

    const released = bookedUtxosOf(booked.state).find((utxo) => utxo.value === 200n);
    expect(released).toBeDefined();
    yield* Effect.promise(() => wallet.unshielded.revertUtxos([idOf(released!)]));
    const afterRelease = yield* publicState(wallet.unshielded);
    expect(valuesOf(utxosOf(afterRelease.state))).toEqual([200n]);
    expect(valuesOf(bookedUtxosOf(afterRelease.state))).toEqual([100n, 300n]);
  });

describe('an unshielded wallet releasing booked coins by id', () => {
  it('should return the named booked coin to available on the V1 variant, and ignore an id that is not booked', async () =>
    Effect.gen(function* () {
      const wallet = yield* walletWithEverythingBooked(v8Version);
      expect(yield* wallet.activeTag).toBe(V1Tag);

      yield* releasesOnlyTheNamedBookedCoin(wallet);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should return the named booked coin to available on the V2 variant, and ignore an id that is not booked', async () =>
    Effect.gen(function* () {
      const wallet = yield* walletWithEverythingBooked(v9Version);
      expect(yield* wallet.activeTag).toBe(V2Tag);

      yield* releasesOnlyTheNamedBookedCoin(wallet);
    }).pipe(Effect.scoped, Effect.runPromise));
});
