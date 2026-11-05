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
 * Starting and stepping the single-variant dust wallet with keys for more ledger versions than it runs.
 *
 * @remarks
 *   A facade derives one ledger version's `DustSecretKey` per side of every boundary and hands that same product to
 *   whichever dust wallet it holds. The single-variant composition runs the V2 variant alone, so it takes the ledger-v9
 *   side and leaves the rest — shown here by what it synchronizes, which only the right key can read.
 */

import { DustSecretKey as V8SecretKey } from '@midnight-ntwrk/ledger-v8';
import { DustSecretKey as V9SecretKey } from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, Option, type Scope, Stream, pipe } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { type DustKeysByEpoch } from '../DustWallet.js';
import { type DustWalletAPI } from '../DustWalletAPI.js';
import { type CustomizedDustWallet } from '../SingleVariantDustWallet.js';
import { DUST_EVENT_COUNT, type DustChain, buildDustChain, dustSeed } from '../v1/test/dustEvents.js';
import { type CoreWallet as V2CoreWallet } from '../v2/CoreWallet.js';
import { dustParameters as v9DustParameters } from '../v2/test/dustEvents.js';
import { makeSingleVariantWallet } from './forkHarness.js';
import { numberedFrom } from './forkReplay.js';
import { balanceAt, dustCount } from './forkWalletAssertions.js';

// Building a real dust chain (rewards + registrations through WASM) does not fit vitest's 5s default on a CI runner.
vi.setConfig({ testTimeout: 60_000 });

const networkId = NetworkId.NetworkId.Undeployed;

/** The version the timeline is reported at: any, since the one variant answers for all of them. */
const chainVersion = ProtocolVersion.ProtocolVersion(9n);

/** One ledger version's dust key per side of the boundary, as a facade derives them from the dust seed. */
const keysByEpoch = (): DustKeysByEpoch => ({
  v8: V8SecretKey.fromSeed(dustSeed()),
  v9: V9SecretKey.fromSeed(dustSeed()),
});

/** The single-variant wallet over a timeline that is already there, never started. */
const walletOver = (chain: DustChain): Effect.Effect<CustomizedDustWallet, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() =>
      makeSingleVariantWallet({
        replayed: Effect.succeed(numberedFrom(chain.eventBytes, 1, Number(chainVersion))),
        networkId,
        seed: dustSeed(),
        dustParameters: v9DustParameters(),
        syncTime: chain.syncTime,
      }),
    ),
    (wallet) => Effect.promise(() => wallet.stop()),
  );

/**
 * The first state the wallet publishes that satisfies `predicate`, read off its runtime.
 *
 * Monotone predicates only: the stream keeps just the latest value.
 */
const stateOf = (wallet: CustomizedDustWallet, predicate: (wallet: V2CoreWallet) => boolean) =>
  pipe(
    wallet.runtime.stateChanges,
    Stream.filter(({ state }) => predicate(state)),
    Stream.take(1),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

describe('a single-variant dust wallet held the way a facade holds it', () => {
  it('should synchronize when started with both ledger versions’ keys, because it takes the ledger-v9 side', async () =>
    Effect.gen(function* () {
      const chain = yield* Effect.promise(() => buildDustChain());
      const wallet = yield* walletOver(chain);
      const heldByFacade: DustWalletAPI<DustKeysByEpoch> = wallet;

      yield* Effect.promise(() => heldByFacade.start(keysByEpoch()));

      const synced = yield* stateOf(wallet, (state) => dustCount(state) === DUST_EVENT_COUNT);
      expect(balanceAt(synced.state, chain.syncTime)).toBeGreaterThan(0n);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should read the timeline in one step from both ledger versions’ keys, because it takes the ledger-v9 side', async () =>
    Effect.gen(function* () {
      const chain = yield* Effect.promise(() => buildDustChain());
      const wallet = yield* walletOver(chain);
      const heldByFacade: DustWalletAPI<DustKeysByEpoch> = wallet;

      yield* Effect.promise(() => heldByFacade.stepSync(keysByEpoch()));

      const stepped = yield* stateOf(wallet, () => true);
      expect(dustCount(stepped.state)).toBe(DUST_EVENT_COUNT);
      expect(balanceAt(stepped.state, chain.syncTime)).toBeGreaterThan(0n);
    }).pipe(Effect.scoped, Effect.runPromise));
});
