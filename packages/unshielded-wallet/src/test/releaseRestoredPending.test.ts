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
 * Reconciling bookings restored from a snapshot, through the forking wallet an application holds.
 *
 * @remarks
 *   A booking that comes back from a snapshot outlived the process that took it, so the wallet cannot tell on its own
 *   whether the transaction behind it is still live. `releaseRestoredPending` is how a caller holding a durable record
 *   says which of them still are: the ones it names stay booked, and every other restored booking is released. The
 *   forking wallet dispatches the call to whichever variant the snapshot restored onto, so each side of the boundary is
 *   pinned here: a dispatch arm that dropped the call, or a variant that ignored it, would strand the bookings on that
 *   side only.
 *
 *   The snapshots are the suite's own: each is written by a running wallet that built a transfer through its public API,
 *   so what is restored is a real booking rather than a hand-written fixture that could drift from it.
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

/** Far enough ahead that nothing here expires, so expiry cannot be what releases a booking. */
const ttl = new Date(2_000_000_000_000);

/** More than either of the wallet's two coins covers, so the transfer books both. */
const transferAmount = 250n;

/** A chain sitting on one side of the boundary: two coins, every message reported at the same version. */
const chainAt = (protocolVersion: number) => [
  timelineTransaction({ id: 1, protocolVersion, owner: owner.addressHex, value: 100n }),
  timelineTransaction({ id: 2, protocolVersion, owner: owner.addressHex, value: 200n }),
];

/** A probe answering as a chain on `version` would, so the wallet starts on the variant that owns it. */
const chainReporting =
  (version: number): ChainVersionProbe =>
  () =>
    Promise.resolve(ProtocolVersion.ProtocolVersion(BigInt(version)));

const valuesOf = (utxos: readonly CarriedUtxo[]): readonly bigint[] => utxos.map((u) => u.value);

/** The id a coin is booked under, as `releaseRestoredPending` names it. */
const idOf = (utxo: CarriedUtxo): string => `${utxo.intentHash}#${utxo.outputNo}`;

/** The wallet's current state, as its public API projects it. */
const publicState = (wallet: ForkWallet['unshielded']) => Effect.promise(() => rx.firstValueFrom(wallet.state));

/**
 * A wallet restored from a snapshot holding two booked coins, written on a chain at `protocolVersion`.
 *
 * @remarks
 *   The writer is synced to the chain's end and builds a transfer that books both coins, then saves itself. Restoring is
 *   a class-level entry point, so the restored wallet comes from the writer's class — the same registration that wrote
 *   the snapshot.
 */
const restoredWithTwoBookings = (
  protocolVersion: number,
): Effect.Effect<ForkWallet['unshielded'], never, Scope.Scope> =>
  Effect.gen(function* () {
    const writer = yield* makeForkWallet({
      timeline: chainAt(protocolVersion),
      forkVersion,
      publicKey: owner,
      chainVersionProbe: chainReporting(protocolVersion),
    });
    yield* Effect.addFinalizer(() => writer.stop);

    const settled = yield* Effect.fork(writer.awaitState((state) => state.state.progress.appliedId === 2n));
    yield* writer.start;
    yield* settled.await.pipe(Effect.flatMap(identity), Effect.orDie);

    yield* Effect.promise(() =>
      writer.unshielded.transferTransaction(
        [{ amount: transferAmount, type: timelineTokenType, receiverAddress: stranger }],
        ttl,
      ),
    );
    const snapshot = yield* Effect.promise(() => writer.unshielded.serializeState());

    const restored = writer.walletClass.restore(snapshot);
    yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));
    return restored;
  });

/** The tag of the variant a wallet is running. */
const runningTag = (wallet: ForkWallet['unshielded']): Effect.Effect<string | symbol> =>
  Effect.map(wallet.runtime.currentVariant, (current) => current.runningVariant.__polyTag__);

/**
 * The claim, made of whichever variant `wallet` restored onto: the restored booking named as covered stays booked, and
 * the one nothing accounts for returns to the available set.
 */
const keepsTheCoveredBookingAndReleasesTheOther = (wallet: ForkWallet['unshielded']) =>
  Effect.gen(function* () {
    const restored = yield* publicState(wallet);
    // The premise, asserted rather than assumed: both bookings survived the snapshot, leaving nothing available.
    expect(valuesOf(bookedUtxosOf(restored.state))).toEqual([100n, 200n]);
    expect(valuesOf(utxosOf(restored.state))).toEqual([]);

    const covered = bookedUtxosOf(restored.state).find((utxo) => utxo.value === 200n);
    expect(covered).toBeDefined();
    yield* Effect.promise(() => wallet.releaseRestoredPending([idOf(covered!)]));
    const reconciled = yield* publicState(wallet);

    expect(valuesOf(bookedUtxosOf(reconciled.state))).toEqual([200n]);
    expect(valuesOf(utxosOf(reconciled.state))).toEqual([100n]);
  });

describe('an unshielded wallet reconciling the bookings it restored from a snapshot', () => {
  it('should release a restored booking nothing accounts for and keep the covered one, on the V1 variant', async () =>
    Effect.gen(function* () {
      const wallet = yield* restoredWithTwoBookings(v8Version);
      expect(yield* runningTag(wallet)).toBe(V1Tag);

      yield* keepsTheCoveredBookingAndReleasesTheOther(wallet);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should release a restored booking nothing accounts for and keep the covered one, on the V2 variant', async () =>
    Effect.gen(function* () {
      const wallet = yield* restoredWithTwoBookings(v9Version);
      expect(yield* runningTag(wallet)).toBe(V2Tag);

      yield* keepsTheCoveredBookingAndReleasesTheOther(wallet);
    }).pipe(Effect.scoped, Effect.runPromise));
});
