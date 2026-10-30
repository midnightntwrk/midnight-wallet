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
 * Stepping a forking dust wallet by hand while it is on its V1 variant.
 *
 * @remarks
 *   A step is one pass of a sync service that ends, and the only such service a dust wallet ships is the projections one,
 *   which rests on `DustLocalState` members only ledger-v9 has. The V1 variant runs ledger-v8, so it has no step to
 *   take: below `forks.v9` a dust wallet synchronizes in the background, once started. Asked to step there, it says so
 *   rather than resolving having read nothing, and it rejects with the error itself, naming the protocol version it is
 *   at, so a caller can recognise it with `instanceof`.
 *
 *   The ledger-v8 source here ends at once, so a step that wrongly went ahead would resolve rather than hang.
 */

import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, Option, Stream, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import { ManualSyncUnsupportedError } from '../DustWallet.js';
import { V1Tag } from '../v1/RunningV1Variant.js';
import { dustParameters as v8DustParameters, dustSeed } from '../v1/test/dustEvents.js';
import { dustParameters as v9DustParameters } from '../v2/test/dustEvents.js';
import { type ForkWallet, type ForkedState, makeForkWallet } from './forkHarness.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its V2 variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);

/** A forking dust wallet built from a seed, on the V1 variant a wallet with no history is on, and never started. */
const walletBelowTheBoundary: Effect.Effect<ForkWallet> = makeForkWallet({
  v8: Stream.empty,
  // The chain never forks here, so the replay never happens.
  replayed: Effect.never,
  networkId,
  forkVersion,
  seed: dustSeed(),
  dustParameters: { v8: v8DustParameters(), v9: v9DustParameters() },
  syncTime: new Date(0),
});

/** The tag of the variant a wallet is running. */
const runningTag = (wallet: ForkWallet['dust']): Effect.Effect<string | symbol> =>
  wallet.runtime.currentVariant.pipe(Effect.map((current) => current.runningVariant.__polyTag__));

/** The state a wallet holds now, read off its runtime. */
const currentState = (wallet: ForkWallet['dust']): Effect.Effect<ForkedState, unknown> =>
  pipe(wallet.runtime.stateChanges, Stream.take(1), Stream.runHead, Effect.map(Option.getOrThrow));

/** What a wallet call rejected with, exactly as a caller catches it, or `undefined` if it resolved. */
const rejectionOf = (call: Promise<unknown>): Effect.Effect<unknown> =>
  Effect.promise(() =>
    call.then(
      () => undefined,
      (rejection: unknown) => rejection,
    ),
  );

describe('a forking dust wallet stepped by hand on its V1 variant', () => {
  it('should refuse a wallet restored from a snapshot written below forks.v9, because ledger-v8 has no projections sync to step', async () =>
    Effect.gen(function* () {
      const writer = yield* walletBelowTheBoundary;
      const snapshot = yield* Effect.promise(() => writer.dust.serializeState());
      yield* writer.stop;

      const restored = writer.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));
      expect(yield* runningTag(restored)).toBe(V1Tag);
      const { protocolVersion } = (yield* currentState(restored)).state;
      expect(protocolVersion).toBeLessThan(forkVersion);

      const rejection = yield* rejectionOf(restored.stepSync(writer.keys));

      expect(rejection).toBeInstanceOf(ManualSyncUnsupportedError);
      expect(rejection).toMatchObject({ protocolVersion });
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should refuse a wallet that holds both ledger versions’ keys, because the refusal is about the variant and not the keys', async () =>
    Effect.gen(function* () {
      const wallet = yield* walletBelowTheBoundary;
      yield* Effect.addFinalizer(() => wallet.stop);
      expect(yield* wallet.activeTag).toBe(V1Tag);
      const { protocolVersion } = (yield* currentState(wallet.dust)).state;
      expect(protocolVersion).toBeLessThan(forkVersion);

      const rejection = yield* rejectionOf(wallet.dust.stepSync(wallet.keys));

      expect(rejection).toBeInstanceOf(ManualSyncUnsupportedError);
      expect(rejection).toMatchObject({ protocolVersion });
    }).pipe(Effect.scoped, Effect.runPromise));
});
