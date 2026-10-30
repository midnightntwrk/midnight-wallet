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
 * Stepping a forking dust wallet by hand while it is on its V2 variant.
 *
 * @remarks
 *   A step is handed the same keys a start is: one ledger version's `DustSecretKey` per side of the boundary, because a
 *   caller stepping a wallet — a facade's `doSync` — does not know which variant it is on. From `forks.v9` the V2
 *   variant is the one running, so the step reads the timeline with the ledger-v9 key and leaves the other.
 *
 *   The wallet is never started: a wallet driven by hand is left unstarted, so what it holds after the step is what the
 *   step read, and nothing a background synchronization could have read for it.
 */

import { LedgerParameters as V8LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { Effect, Stream } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { DUST_EVENT_COUNT, buildDustChain, dustSeed } from '../v1/test/dustEvents.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import { dustParameters as v9DustParameters } from '../v2/test/dustEvents.js';
import { makeForkWallet } from './forkHarness.js';
import { numberedFrom } from './forkReplay.js';
import { balanceAt, dustCount } from './forkWalletAssertions.js';

// Building a real dust chain (rewards + registrations through WASM) does not fit vitest's 5s default on a CI runner.
vi.setConfig({ testTimeout: 60_000 });

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its V2 variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has already forked — past the boundary rather than exactly at it. */
const v9Version = ProtocolVersion.ProtocolVersion(9n);

/** A probe answering as a chain on `version` would. */
const chainReporting =
  (version: ProtocolVersion.ProtocolVersion): ChainVersionProbe =>
  () =>
    Promise.resolve(version);

describe('a forking dust wallet stepped by hand on its V2 variant', () => {
  it('should read the timeline in one step from keys given for both ledger versions, because it takes the ledger-v9 side', async () =>
    Effect.gen(function* () {
      const chain = yield* Effect.promise(() => buildDustChain());
      const wallet = yield* makeForkWallet({
        v8: Stream.empty,
        replayed: Effect.succeed(numberedFrom(chain.eventBytes, 1, Number(v9Version))),
        networkId,
        forkVersion,
        seed: dustSeed(),
        dustParameters: { v8: V8LedgerParameters.initialParameters().dust, v9: v9DustParameters() },
        syncTime: chain.syncTime,
        chainVersionProbe: chainReporting(v9Version),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      expect(yield* wallet.activeTag).toBe(V2Tag);

      yield* Effect.promise(() => wallet.dust.stepSync(wallet.keys));

      const stepped = yield* wallet.currentState;
      expect(dustCount(stepped.state)).toBe(DUST_EVENT_COUNT);
      expect(balanceAt(stepped.state, chain.syncTime)).toBeGreaterThan(0n);
      expect(yield* wallet.activeTag).toBe(V2Tag);
    }).pipe(Effect.scoped, Effect.runPromise));
});
