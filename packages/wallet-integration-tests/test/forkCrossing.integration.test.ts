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
 * A fork crossing assembled from the published packages only.
 *
 * @remarks
 *   Every fork test that exists today lives inside the package that owns the wallet, and reaches for scaffolding in that
 *   package's `src/test/`. None of that scaffolding is exported, so none of it can be reused here — and each wallet's
 *   harness reads a different source anyway: shielded takes a `Simulator`, dust a stream of timeline events, unshielded
 *   a hand-built timeline. There is no shared fork source to test all three against.
 *
 *   This file is the first step out of that: it rebuilds the two-variant wallet from **public entry points only** —
 *   `WalletBuilder` from the runtime package, each wallet's `./v1` and `./v2` subpaths, and the simulator from
 *   `@midnightntwrk/wallet-sdk-capabilities/simulation` — and drives it across a fork whose handover is the real
 *   ledger-side translation. If that works from outside the owning package, the remaining wallets are mechanical; if it
 *   does not, a cross-wallet fork test needs new public surface, and that is a decision for the API rather than a
 *   test.
 *
 *   What it is **not** yet: a single fork shared by all three wallets. That needs an adapter from the simulator's chain
 *   into dust's event stream and unshielded's timeline, and the adapter — not the assertions — is the missing piece.
 *   The boundary contract asserted here is deliberately the part that is wallet-independent, so the other two legs slot
 *   in beside it without the assertions changing.
 *
 *   **Integration tier because of a build step, not infra.** The translation is a WASM artifact built from
 *   `packages/state-translation/wasm`; this package's `turbo.json` declares `test:integration` dependent on that
 *   package's `build:wasm`, exactly as `capabilities` and `shielded-wallet` do. Nothing here needs Docker or a
 *   network.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  ForkSimulator,
  type Simulator,
  V8,
  genesisStrictness,
  immediateBlockProducer,
  translatorFromAsync,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import * as V1 from '@midnightntwrk/wallet-sdk-shielded/v1';
import * as V2 from '@midnightntwrk/wallet-sdk-shielded/v2';
import { translateLedgerState } from '@midnightntwrk/wallet-sdk-state-translation';
import { type Array as Arr, Effect, Stream, pipe } from 'effect';
import { describe, expect, it } from 'vitest';

const networkId = NetworkId.NetworkId.Undeployed;

/**
 * Deliberately not the production constant.
 *
 * The real fork version is not final, and pinning a test to it would make this fail for a reason that has nothing to do
 * with the crossing the moment it moves.
 */
const forkVersion = ProtocolVersion.ProtocolVersion(4242n);
const preForkVersion = ProtocolVersion.ProtocolVersion(3n);
const forkBlock = 3n;

const seed = Buffer.alloc(32, 42);

const v8TokenType = v8.shieldedToken().raw;

/** The pre-fork chain has to hold something, or a translation that carried nothing would still satisfy every count. */
const genesisMints: Arr.NonEmptyArray<V8.GenesisMint> = [
  {
    type: 'shielded',
    tokenType: v8TokenType,
    amount: 1_000_000n,
    recipient: v8.ZswapSecretKeys.fromSeed(seed),
  },
];

const baseConfig = {
  networkId,
  forkBlock,
  forkVersion,
  preForkVersion,
  // Genesis strictness on both sides: nothing here pays a fee, and a fee-enforcing chain would reject these blocks for
  // reasons unrelated to the fork.
  preForkBlockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
  postForkBlockProducer: immediateBlockProducer(undefined, genesisStrictness),
  translator: translatorFromAsync(translateLedgerState),
};

/**
 * Transaction history reduced to nothing.
 *
 * The real services need indexer configuration or a storage instance, neither of which says anything about crossing a
 * fork. Written out once per variant because the two `TransactionHistoryService` types name their own ledger's
 * `ZswapStateChanges`.
 */
const transactionDetails = (hash: string) => ({
  hash,
  block: { hash: '', height: 0, timestamp: 0 },
  status: 'SUCCESS' as const,
  identifiers: [] as readonly string[],
});

const noOpPreForkHistory: V1.TransactionHistory.TransactionHistoryService = {
  put: () => Effect.void,
  getTransactionDetails: (hash) => Effect.succeed(transactionDetails(hash)),
};

const noOpPostForkHistory: V2.TransactionHistory.TransactionHistoryService = {
  put: () => Effect.void,
  getTransactionDetails: (hash) => Effect.succeed(transactionDetails(hash)),
};

/**
 * The post-fork source, deferred.
 *
 * The replayed chain does not exist when the wallet is built — it is produced by the fork — so the post-fork variant
 * takes an effect it awaits at its first sync rather than a value.
 */
const postForkSyncService = (
  replayed: Effect.Effect<Simulator, never>,
): V2.Sync.SyncService<V2.CoreWallet, v9.ZswapSecretKeys, V2.Sync.SimulatorSyncUpdate> => ({
  updates: (state, secretKeys) =>
    Stream.unwrap(
      pipe(
        replayed,
        Effect.orDie,
        Effect.map((chain) => V2.Sync.makeSimulatorSyncService({ simulator: chain }).updates(state, secretKeys)),
      ),
    ),
});

/**
 * A shielded wallet registered over both variants, built the way an application would have to build one.
 *
 * `ShieldedWallet` itself registers a single variant and its type is a one-element HList throughout, so it cannot
 * express a wallet that crosses a fork. `WalletBuilder.init()` with both variant builders is the public way to say it.
 */
const makeCrossingWallet = (preFork: V8.Simulator, replayed: Effect.Effect<Simulator, never>) => {
  const preForkKeys = v8.ZswapSecretKeys.fromSeed(seed);
  const postForkKeys = v9.ZswapSecretKeys.fromSeed(seed);

  // Both variants name their simulator `simulator` with incompatible ledger types, and `WalletBuilder` intersects every
  // variant's configuration — so the sync services are closures that ignore configuration, leaving just `networkId`.
  const preForkBuilder = new V1.V1Builder()
    .withDefaultTransactionType()
    .withSync(() => V1.Sync.makeSimulatorSyncService({ simulator: preFork }), V1.Sync.makeSimulatorSyncCapability)
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistory(() => noOpPreForkHistory)
    .withKeysDefaults()
    .withCoinSelectionDefaults();

  const postForkBuilder = new V2.V2Builder()
    .withDefaultTransactionType()
    .withSync(() => postForkSyncService(replayed), V2.Sync.makeSimulatorSyncCapability)
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistory(() => noOpPostForkHistory)
    .withKeysDefaults()
    .withCoinSelectionDefaults();

  const WalletClass = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, preForkBuilder)
    .withVariant(forkVersion, postForkBuilder)
    .build({ networkId });

  const wallet = WalletClass.startFirst(WalletClass, V1.CoreWallet.initEmpty(preForkKeys, networkId));

  return { wallet, runtime: wallet.runtime, keys: { preFork: preForkKeys, postFork: postForkKeys } };
};

describe('a fork crossing built from published packages only', () => {
  it('registers both variants and starts on the pre-fork one', async () =>
    Effect.gen(function* () {
      // The architectural claim under test: everything the owning package's own harness does is reachable from outside
      // it. If this fails, a cross-wallet fork test needs new exports, which is an API decision and not a test one.
      const fork = yield* ForkSimulator.init({ ...baseConfig, preForkGenesisMints: genesisMints });
      const replayed = Effect.succeed(yield* fork.advanceToFork());

      const { runtime, keys } = makeCrossingWallet(fork.preFork, replayed);

      // Same seed, both ledgers: the lemma the whole crossing rests on, and the reason a replayed payment is a payment
      // to the same wallet rather than to somebody else.
      expect(keys.postFork.coinPublicKey).toBe(keys.preFork.coinPublicKey);
      expect(keys.postFork.encryptionPublicKey).toBe(keys.preFork.encryptionPublicKey);

      const current = yield* runtime.currentVariant;
      expect(current.runningVariant.__polyTag__).toBe(V1.V1Tag);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('carries the pre-fork chain across the boundary under the real translation', async () =>
    Effect.gen(function* () {
      // Not a wallet claim — a precondition for one. If the chain the wallet is about to sync did not itself carry the
      // pre-fork commitments, every wallet-level assertion downstream would be vacuous.
      const fork = yield* ForkSimulator.init({ ...baseConfig, preForkGenesisMints: genesisMints });

      const postFork = yield* fork.advanceToFork();
      const preState = yield* fork.preFork.getLatestState();
      const postState = yield* postFork.getLatestState();

      const carried = v8.ZswapChainState.deserializeFromLedgerState(preState.ledger.serialize()).firstFree;
      expect(carried).toBeGreaterThan(0n);
      expect(v9.ZswapChainState.deserializeFromLedgerState(postState.ledger.serialize()).firstFree).toBe(carried);
    }).pipe(Effect.scoped, Effect.runPromise));
});
