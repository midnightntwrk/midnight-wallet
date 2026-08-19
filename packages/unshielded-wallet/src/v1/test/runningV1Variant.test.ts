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
//
// The version signals the running variant puts on its state stream: an ordinary transition, and the healing emission
// that rescues a snapshot restored at a version this variant does not own.
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { StateChange, type Variant, VersionChangeType } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { Duration, Effect, Scope, Stream, SubscriptionRef } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { RunningV1Variant } from '../RunningV1Variant.js';
import { UnshieldedState } from '../UnshieldedState.js';
import { fixtureOwner } from './syncFixtures.js';

const owner = fixtureOwner();

/** The variant owns versions 0..6. */
const activationRange = ProtocolVersion.makeRange(
  ProtocolVersion.MinSupportedVersion,
  ProtocolVersion.ProtocolVersion(7n),
);

const walletAt = (protocolVersion: bigint): CoreWallet =>
  CoreWallet.restore(
    UnshieldedState.empty(),
    owner,
    { appliedId: 0n, highestTransactionId: 0n },
    ProtocolVersion.ProtocolVersion(protocolVersion),
    NetworkId.NetworkId.Undeployed,
  );

/**
 * Drains the variant's state stream for a bounded window and returns the versions it announced.
 *
 * @remarks
 *   Bounded by time rather than by `Stream.take(n)` on purpose: a missing emission has to surface as a failed assertion
 *   on an empty list, not as a hung test.
 */
const announcedVersions = (
  initial: CoreWallet,
  drive: (ref: SubscriptionRef.SubscriptionRef<CoreWallet>) => Effect.Effect<void>,
): Promise<readonly bigint[]> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const stateRef = yield* SubscriptionRef.make(initial);
    const context: Variant.VariantContext<CoreWallet> = { stateRef, activationRange };
    const variant = new RunningV1Variant(scope, context, {} as never);

    const collected = yield* Effect.fork(
      variant.state.pipe(
        Stream.interruptAfter(Duration.millis(300)),
        Stream.filter(StateChange.isVersionChange),
        Stream.map((change) =>
          VersionChangeType.isVersion(change.change) ? change.change.version : ProtocolVersion.ProtocolVersion(-1n),
        ),
        Stream.runCollect,
      ),
    );

    // Let the collector's subscription attach before driving the change: `SubscriptionRef.changes` replays only the
    // value current at subscription time, so a change published first would be indistinguishable from no change.
    yield* Effect.sleep(Duration.millis(50));
    yield* drive(stateRef);
    const chunk = yield* collected.await;
    return chunk._tag === 'Success' ? Array.from(chunk.value) : [];
  }).pipe(Effect.scoped, Effect.runPromise);

describe('unshielded running variant version signals', () => {
  it('announces a version transition observed on the state', async () => {
    const versions = await announcedVersions(walletAt(0n), (ref) => SubscriptionRef.set(ref, walletAt(5n)));

    expect(versions).toEqual([5n]);
  });

  it('heals a state restored outside the activation range by announcing it immediately', async () => {
    const versions = await announcedVersions(walletAt(9n), () => Effect.void);

    expect(versions).toEqual([9n]);
  });

  it('announces nothing for a state restored inside the activation range', async () => {
    const emissions = await Effect.gen(function* () {
      const scope = yield* Scope.make();
      const stateRef = yield* SubscriptionRef.make(walletAt(3n));
      const context: Variant.VariantContext<CoreWallet> = { stateRef, activationRange };
      const variant = new RunningV1Variant(scope, context, {} as never);

      const chunk = yield* variant.state.pipe(Stream.interruptAfter(Duration.millis(300)), Stream.runCollect);
      return Array.from(chunk);
    }).pipe(Effect.scoped, Effect.runPromise);

    // No version announcement...
    expect(emissions.filter(StateChange.isVersionChange)).toEqual([]);
    // ...but the stream was genuinely live, so the empty result above is not a false pass.
    expect(emissions.filter(StateChange.isState).length).toBeGreaterThan(0);
  });
});
