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
 * Restoring a snapshot into the variant that wrote it, through the wallet class an application holds.
 *
 * @remarks
 *   `restore.test.ts` pins the routing helpers on hand-built envelopes, and the runtime pins `startAtVariant` over
 *   synthetic variants. Neither says that the two meet correctly in a shipped forking wallet, which is the composition
 *   an application actually calls: peek at the snapshot, resolve the variant that owns the version it declares,
 *   deserialize with _that_ variant's deserializer, and start there.
 *
 *   Both epochs are pinned in one file on purpose. A router that always answered with the head variant would pass the
 *   pre-fork half and fail the post-fork one; a router that always answered with the last registration would do the
 *   reverse. Only routing on the snapshot's own declared version passes both.
 *
 *   The snapshots are the suite's own: each is written by a running wallet through `serializeState()`, so what is
 *   restored is what this package actually produces rather than a fixture that could drift from it.
 */

import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { Effect, Option, type Scope, pipe } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import { peekProtocolVersion } from '../Restore.js';
import { V1Tag } from '../v1/RunningV1Variant.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import { type CarriedUtxo, type ForkWallet, makeForkWallet, utxosOf } from './forkHarness.js';
import { postForkIdentity, timelineTransaction } from './forkTimeline.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its post-fork variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has already forked — past the boundary rather than exactly at it. */
const afterFork = 9;
/** A chain that has not — a version the pre-fork variant owns. */
const beforeFork = 5;

const postFork = postForkIdentity(networkId);

/** The whole history of a chain sitting on one side of the boundary: every message reported at the same version. */
const chainAt = (protocolVersion: number) => [
  timelineTransaction({ id: 1, protocolVersion, owner: postFork.addressHex, value: 100n }),
  timelineTransaction({ id: 2, protocolVersion, owner: postFork.addressHex, value: 200n }),
];

const valuesOf = (utxos: readonly CarriedUtxo[]): readonly bigint[] => utxos.map((u) => u.value);

/** A probe answering as a chain on `version` would. */
const chainReporting =
  (version: number): ChainVersionProbe =>
  () =>
    Promise.resolve(ProtocolVersion.ProtocolVersion(BigInt(version)));

/** A started wallet that has consumed the whole of a chain reported at `protocolVersion`. */
const syncedWalletOnChainAt = (protocolVersion: number): Effect.Effect<ForkWallet, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wallet = yield* makeForkWallet({
      timeline: chainAt(protocolVersion),
      forkVersion,
      publicKey: postFork,
      chainVersionProbe: chainReporting(protocolVersion),
    });
    yield* Effect.addFinalizer(() => wallet.stop);
    yield* wallet.start;
    yield* wallet.awaitState((state) => state.state.progress.appliedId === 2n).pipe(Effect.orDie);
    return wallet;
  });

/** The tag of the variant a wallet is running, read the way the harness reads it of the wallet it started. */
const runningTag = (wallet: ForkWallet['unshielded']): Effect.Effect<string | symbol> =>
  pipe(
    wallet.runtime.currentVariant,
    Effect.map((current) => current.runningVariant.__polyTag__),
  );

/** The first state a restored wallet publishes, which is the one it was restored onto. */
const restoredState = (wallet: ForkWallet['unshielded']) => Effect.promise(() => rx.firstValueFrom(wallet.state));

describe('an unshielded wallet restoring a snapshot through the class it was started from', () => {
  it('restores a snapshot written below the boundary onto the pre-fork variant, with what it held', async () =>
    Effect.gen(function* () {
      const wallet = yield* syncedWalletOnChainAt(beforeFork);
      expect(yield* wallet.activeTag).toBe(V1Tag);
      const synced = yield* wallet.currentState;

      const snapshot = yield* Effect.promise(() => wallet.unshielded.serializeState());
      // The snapshot names the epoch that wrote it, which is the only thing the restore has to go on.
      expect(peekProtocolVersion(snapshot)).toStrictEqual(
        Option.some(ProtocolVersion.ProtocolVersion(BigInt(beforeFork))),
      );

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      expect(yield* runningTag(restored)).toBe(V1Tag);

      const state = yield* restoredState(restored);
      expect(state.protocolVersion).toBeLessThan(forkVersion);
      expect(valuesOf(utxosOf(state.state))).toEqual([100n, 200n]);
      expect(state.state.publicKey.address).toBe(synced.state.publicKey.address);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('restores a snapshot written at or past the boundary onto the post-fork variant, with what it held', async () =>
    Effect.gen(function* () {
      const wallet = yield* syncedWalletOnChainAt(afterFork);
      expect(yield* wallet.activeTag).toBe(V2Tag);
      const synced = yield* wallet.currentState;

      const snapshot = yield* Effect.promise(() => wallet.unshielded.serializeState());
      expect(peekProtocolVersion(snapshot)).toStrictEqual(
        Option.some(ProtocolVersion.ProtocolVersion(BigInt(afterFork))),
      );

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      expect(yield* runningTag(restored)).toBe(V2Tag);

      const state = yield* restoredState(restored);
      expect(state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(valuesOf(utxosOf(state.state))).toEqual([100n, 200n]);
      expect(state.state.publicKey.address).toBe(synced.state.publicKey.address);
    }).pipe(Effect.scoped, Effect.runPromise));
});
