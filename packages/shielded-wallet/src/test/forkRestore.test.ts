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
 *   deserialize with *that* variant's deserializer, and start there.
 *
 *   Both epochs are pinned in one file on purpose. A router that always answered with the head variant would pass the
 *   pre-fork half and fail the post-fork one; a router that always answered with the last registration would do the
 *   reverse. Only routing on the snapshot's own declared version passes both.
 *
 *   The snapshots are the suite's own: each is written by a running wallet through `serializeState()`, so what is
 *   restored is what this package actually produces rather than a fixture that could drift from it.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { V8, genesisStrictness, immediateBlockProducer } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect, Option, pipe } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import { peekProtocolVersion } from '../Restore.js';
import { V1Tag } from '../v1/index.js';
import { V2Tag } from '../v2/index.js';
import { type ForkWallet, makeForkWallet } from './forkHarness.js';
import { type ReplayedCoin, makeReplayChain, mintable, preForkPayment } from './forkReplay.js';
import { coinValues, totalValue } from './forkWalletAssertions.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its post-fork variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has already forked — past the boundary rather than exactly at it. */
const afterFork = ProtocolVersion.ProtocolVersion(9n);
/** A chain that has not — a version the pre-fork variant owns. */
const beforeFork = ProtocolVersion.ProtocolVersion(5n);

const forkBlock = 4n;

const seed = Buffer.alloc(32, 42);

const walletValues = [100n, 200n] as const;
const walletTotal = walletValues.reduce((sum, value) => sum + value, 0n);

const walletRecipient = () => {
  const keys = v8.ZswapSecretKeys.fromSeed(seed);
  return { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey };
};

const chainCoins = (): readonly ReplayedCoin[] =>
  walletValues.map((value) => mintable(v8.shieldedToken().raw, value, walletRecipient()));

/** A ledger-v8 chain stamped with `version` from its genesis block, paying the wallet one coin per block. */
const chainAt = (version: ProtocolVersion.ProtocolVersion, coins: readonly ReplayedCoin[]) =>
  Effect.gen(function* () {
    const chain = yield* V8.Simulator.init({
      networkId,
      protocolVersion: version,
      blockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
    });
    yield* Effect.forEach(coins, (coin) => chain.submitTransaction(preForkPayment(networkId, coin)), {
      discard: true,
    });
    return chain;
  });

/** The post-fork source: the same coins, re-announced by the post-fork ledger version. */
const replayOf = (coins: readonly ReplayedCoin[], chain: V8.Simulator) =>
  Effect.gen(function* () {
    const genesisTime = yield* chain.query((state) => state.currentTime);
    return yield* makeReplayChain({
      networkId,
      protocolVersion: afterFork,
      genesisBlockNumber: forkBlock,
      genesisTime,
      blockProducer: immediateBlockProducer(undefined, genesisStrictness),
      coins,
    });
  });

/** A probe answering as a chain on `version` would. */
const chainReporting =
  (version: ProtocolVersion.ProtocolVersion): ChainVersionProbe =>
  () =>
    Promise.resolve(version);

/** The tag of the variant a wallet is running, read the way the harness reads it of the wallet it started. */
const runningTag = (wallet: ForkWallet['shielded']): Effect.Effect<string | symbol> =>
  pipe(
    wallet.runtime.currentVariant,
    Effect.map((current) => current.runningVariant.__polyTag__),
  );

/** The first state a restored wallet publishes, which is the one it was restored onto. */
const restoredState = (wallet: ForkWallet['shielded']) => Effect.promise(() => rx.firstValueFrom(wallet.state));

describe('a shielded wallet restoring a snapshot through the class it was started from', () => {
  it('restores a snapshot written below the boundary onto the pre-fork variant, with what it held', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const chain = yield* chainAt(beforeFork, coins);
      const replayed = yield* replayOf(coins, chain);

      const wallet = yield* makeForkWallet({
        preFork: chain,
        replayed: Effect.succeed(replayed),
        networkId,
        forkVersion,
        seed,
        chainVersionProbe: chainReporting(beforeFork),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(yield* wallet.activeTag).toBe(V1Tag);

      const snapshot = yield* Effect.promise(() => wallet.shielded.serializeState());
      // The snapshot names the epoch that wrote it, which is the only thing the restore has to go on.
      expect(Option.getOrThrow(peekProtocolVersion(snapshot))).toBe(synced.state.protocolVersion);
      expect(synced.state.protocolVersion).toBeLessThan(forkVersion);

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      expect(yield* runningTag(restored)).toBe(V1Tag);

      const state = yield* restoredState(restored);
      expect(state.protocolVersion).toBeLessThan(forkVersion);
      expect(coinValues(state.state)).toEqual([...walletValues]);
      expect(state.state.publicKeys).toStrictEqual(synced.state.publicKeys);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('restores a snapshot written at or past the boundary onto the post-fork variant, with what it held', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const chain = yield* chainAt(afterFork, coins);
      const replayed = yield* replayOf(coins, chain);

      const wallet = yield* makeForkWallet({
        preFork: chain,
        replayed: Effect.succeed(replayed),
        networkId,
        forkVersion,
        seed,
        chainVersionProbe: chainReporting(afterFork),
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      const synced = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(yield* wallet.activeTag).toBe(V2Tag);

      const snapshot = yield* Effect.promise(() => wallet.shielded.serializeState());
      expect(Option.getOrThrow(peekProtocolVersion(snapshot))).toBe(synced.state.protocolVersion);
      expect(synced.state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);

      const restored = wallet.walletClass.restore(snapshot);
      yield* Effect.addFinalizer(() => Effect.promise(() => restored.stop()));

      expect(yield* runningTag(restored)).toBe(V2Tag);

      const state = yield* restoredState(restored);
      expect(state.protocolVersion).toBeGreaterThanOrEqual(forkVersion);
      expect(coinValues(state.state)).toEqual([...walletValues]);
      expect(state.state.publicKeys).toStrictEqual(synced.state.publicKeys);
    }).pipe(Effect.scoped, Effect.runPromise));
});
