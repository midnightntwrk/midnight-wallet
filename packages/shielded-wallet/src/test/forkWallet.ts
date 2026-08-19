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
 * A shielded wallet registered over _both_ variants, syncing a chain that forks under it — test scaffolding only.
 *
 * @remarks
 *   The shipped `ShieldedWallet` registers exactly one variant and its type is a one-element HList throughout, so it
 *   cannot express a wallet that crosses a fork. Rather than widen the public surface ahead of the API redesign this
 *   builds the two-variant wallet the way `packages/e2e-tests` builds its custom wallets: `WalletBuilder.init()` with
 *   both variant builders registered directly. Nothing here is exported from the package.
 *
 *   The two sides read different sources, which is the shape the real thing has: before the fork the pre-fork chain,
 *   after it the indexer's replayed timeline (see `forkReplay.ts`). The post-fork source does not exist when the wallet
 *   is built, so it is supplied as an effect the post-fork variant awaits at its first sync.
 *
 *   Three things it has to work around, each of which is a real question the public API will have to answer eventually:
 *
 *   - **Configuration collides.** `WalletBuilder` intersects every variant's configuration, and both variants name their
 *       simulator `simulator` — with different, incompatible ledger types. So the sync services are passed as closures
 *       that ignore configuration entirely, leaving the merged configuration as just `networkId`.
 *   - **Start-aux does not cross the boundary.** The pre-fork variant's aux is a ledger-v8 `ZswapSecretKeys`, the post-fork
 *       variant's a ledger-v9 one. A single retained value cannot serve both, so what is retained here is the _seed_,
 *       and each variant is handed keys derived from it — the same public keys either way (asserted by
 *       `forkSimulation.integration.test.ts`), just built by the ledger that variant speaks.
 *   - **The post-fork source does not exist yet** when the wallet is built, hence the effect above.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { type NetworkId, type ProtocolState, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type Simulator, type V8 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { Deferred, Effect, FiberId, Option, Stream, pipe } from 'effect';
import * as V1 from '../v1/index.js';
import * as V2 from '../v2/index.js';

// =============================================================================
// Observation channels
// =============================================================================

/**
 * Both ends of a migration, as plain data, taken at the moment it happened.
 *
 * @remarks
 *   Recorded as plain data rather than by keeping the wallets themselves: the pre-fork state is built on the other
 *   ledger's wasm objects, whose lifetime ends with the variant scope the migration closes.
 *
 *   The `from` side is what the projection was allowed to see; the `to` side is what it produced. Under the replay design
 *   the interesting claim is on the `to` side — that a wallet crossing a fork starts with no coins at all and re-earns
 *   them by syncing, keeping only its identity and the cursor it inherited. `appliedIndex` is captured on both sides
 *   because comparing them is the only place the parked cursor is directly observable: once sync runs, a wallet that
 *   had rewound instead would read the same replay anyway and converge on the same state.
 */
export type CapturedMigration = Readonly<{
  from: Readonly<{
    coinPublicKey: string;
    encryptionPublicKey: string;
    networkId: string;
    protocolVersion: bigint;
    appliedIndex: bigint;
  }>;
  to: Readonly<{
    coinPublicKey: string;
    encryptionPublicKey: string;
    networkId: string;
    protocolVersion: bigint;
    appliedIndex: bigint;
    coinCount: number;
    firstFree: bigint;
    coinHashCount: number;
  }>;
}>;

const captureInput = (previousState: V2.Migration.PreviousLedgerWallet): CapturedMigration['from'] => ({
  coinPublicKey: previousState.publicKeys.coinPublicKey,
  encryptionPublicKey: previousState.publicKeys.encryptionPublicKey,
  networkId: previousState.networkId,
  protocolVersion: previousState.protocolVersion,
  appliedIndex: previousState.progress.appliedIndex,
});

const captureOutput = (migrated: V2.CoreWallet): CapturedMigration['to'] => ({
  coinPublicKey: migrated.publicKeys.coinPublicKey,
  encryptionPublicKey: migrated.publicKeys.encryptionPublicKey,
  networkId: migrated.networkId,
  protocolVersion: migrated.protocolVersion,
  appliedIndex: migrated.progress.appliedIndex,
  coinCount: [...migrated.state.coins].length,
  firstFree: migrated.state.firstFree,
  coinHashCount: Object.keys(migrated.coinHashes).length,
});

/** The real cross-ledger migration, with both ends recorded on the way through. */
const capturingCrossLedgerMigration = (
  captured: Deferred.Deferred<CapturedMigration>,
): V2.Migration.StateMigration<V2.Migration.PreviousLedgerWallet> => {
  const inner = V2.Migration.makeCrossLedgerMigration();
  return {
    migrate: (previousState) =>
      pipe(
        inner.migrate(previousState),
        Effect.tap((migrated) =>
          Deferred.succeed(captured, { from: captureInput(previousState), to: captureOutput(migrated) }),
        ),
      ),
  };
};

// =============================================================================
// Stand-ins for services the proof does not exercise
// =============================================================================

const transactionDetails = (hash: string) => ({
  hash,
  block: { hash: '', height: 0, timestamp: 0 },
  status: 'SUCCESS' as const,
  identifiers: [] as readonly string[],
});

/**
 * Transaction history reduced to nothing.
 *
 * @remarks
 *   The real services need indexer configuration or a storage instance, neither of which says anything about crossing a
 *   fork. Written out once per variant because the two `TransactionHistoryService` types name their own ledger's
 *   `ZswapStateChanges`.
 */
const noOpPreForkHistory: V1.TransactionHistory.TransactionHistoryService = {
  put: () => Effect.void,
  getTransactionDetails: (hash) => Effect.succeed(transactionDetails(hash)),
};

const noOpPostForkHistory: V2.TransactionHistory.TransactionHistoryService = {
  put: () => Effect.void,
  getTransactionDetails: (hash) => Effect.succeed(transactionDetails(hash)),
};

/**
 * The post-fork sync source, deferred until it exists.
 *
 * @remarks
 *   A source that never arrives is a broken harness rather than a wallet error — there is no `WalletError` that means
 *   "the simulated replay did not happen" — so failures are raised as defects instead of being folded into the sync
 *   error channel.
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

// =============================================================================
// The wallet
// =============================================================================

/** Everything needed to build a two-variant shielded wallet over a chain that forks. */
export type ForkWalletConfig = Readonly<{
  /** The pre-fork chain, available immediately. */
  preFork: V8.Simulator;
  /** The post-fork source — the indexer's replayed timeline — which only exists once the fork has happened. */
  replayed: Effect.Effect<Simulator, never>;
  networkId: NetworkId.NetworkId;
  /**
   * The version at which the post-fork variant is registered.
   *
   * The single source of truth for the boundary (D5): the pre-fork variant's activation range ends here, and so does
   * the point at which its sync stops applying. Deliberately not a production constant — the real fork version is not
   * final.
   */
  forkVersion: ProtocolVersion.ProtocolVersion;
  /** The seed both variants derive their keys from. */
  seed: Uint8Array;
}>;

/** A running two-variant shielded wallet, plus the channels a fork proof needs to observe it. */
export type ForkWallet = Readonly<{
  /** Keys of each ledger version, derived from the same seed. */
  keys: Readonly<{ preFork: v8.ZswapSecretKeys; postFork: v9.ZswapSecretKeys }>;
  /** Starts background sync, having first registered the activation watcher that restarts it after a migration. */
  start: Effect.Effect<void, WalletRuntimeError>;
  /** Resolves when the hand-over happens, with both ends of it. */
  awaitMigration: Effect.Effect<CapturedMigration>;
  /** Both ends of the migration, or `None` if none has happened yet. */
  migration: Effect.Effect<Option.Option<CapturedMigration>>;
  /** The tag of the variant currently running — `V1Tag` before a migration, `V2Tag` after one. */
  activeTag: Effect.Effect<string | symbol>;
  /** The wallet's current state, whichever variant produced it. */
  currentState: Effect.Effect<ProtocolState.ProtocolState<V1.CoreWallet | V2.CoreWallet>, WalletRuntimeError>;
  /**
   * Resolves once the wallet's state satisfies `predicate`, failing the test's timeout if it never does.
   *
   * Use monotone predicates only: the runtime's state stream keeps just the latest value, so a state that satisfies a
   * transient predicate can legitimately be skipped.
   */
  awaitState: (
    predicate: (state: ProtocolState.ProtocolState<V1.CoreWallet | V2.CoreWallet>) => boolean,
  ) => Effect.Effect<ProtocolState.ProtocolState<V1.CoreWallet | V2.CoreWallet>, WalletRuntimeError>;
  /** Runs `use` against the running post-fork variant. Fails if the wallet has not migrated. */
  onPostForkVariant: <A, E>(
    use: (
      variant: V2.RunningV2Variant<string, V2.Sync.SimulatorSyncUpdate, v9.FinalizedTransaction, v9.ZswapSecretKeys>,
    ) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | WalletRuntimeError>;
  /** Tears the wallet down. */
  stop: Effect.Effect<void>;
}>;

/**
 * Builds and starts a shielded wallet registered over both variants.
 *
 * @param config - The two sources, the boundary version, the network and the seed.
 * @returns The running wallet and its observation channels.
 */
export const makeForkWallet = (config: ForkWalletConfig): ForkWallet => {
  const { preFork, replayed, networkId, forkVersion, seed } = config;

  const preForkKeys = v8.ZswapSecretKeys.fromSeed(seed);
  const postForkKeys = v9.ZswapSecretKeys.fromSeed(seed);

  const captured = Deferred.unsafeMake<CapturedMigration>(FiberId.none);

  const preForkBuilder = new V1.V1Builder()
    .withDefaultTransactionType()
    .withSync(() => V1.Sync.makeSimulatorSyncService({ simulator: preFork }), V1.Sync.makeSimulatorSyncCapability)
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistory(() => noOpPreForkHistory)
    .withKeysDefaults()
    .withStartAuxDefaults()
    .withCoinSelectionDefaults();

  const postForkBuilder = new V2.V2Builder()
    .withDefaultTransactionType()
    .withSync(() => postForkSyncService(replayed), V2.Sync.makeSimulatorSyncCapability)
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistory(() => noOpPostForkHistory)
    .withKeysDefaults()
    .withStartAuxDefaults()
    .withCoinSelectionDefaults()
    .withMigration(() => capturingCrossLedgerMigration(captured));

  const WalletClass = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, preForkBuilder)
    .withVariant(forkVersion, postForkBuilder)
    .build({ networkId });

  const wallet = WalletClass.startFirst(WalletClass, V1.CoreWallet.initEmpty(preForkKeys, networkId));
  const runtime = wallet.runtime;

  const currentState = pipe(runtime.stateChanges, Stream.take(1), Stream.runHead, Effect.map(Option.getOrThrow));

  return {
    keys: { preFork: preForkKeys, postFork: postForkKeys },

    start: Effect.gen(function* () {
      // Registered before the first dispatch and only once, exactly as `ShieldedWallet.start` does it: the returned
      // effect resolves only once the subscription is live, so the migration cannot outrun the watcher.
      yield* runtime.onVariantActivation({
        [V1.V1Tag]: (v1) => v1.startSyncInBackground(preForkKeys),
        [V2.V2Tag]: (v2) => v2.startSyncInBackground(postForkKeys),
      });
      yield* runtime.dispatch({
        [V1.V1Tag]: (v1) => v1.startSyncInBackground(preForkKeys),
        [V2.V2Tag]: (v2) => v2.startSyncInBackground(postForkKeys),
      });
    }),

    awaitMigration: Deferred.await(captured),

    migration: Deferred.poll(captured).pipe(
      Effect.flatMap(Option.match({ onNone: () => Effect.succeedNone, onSome: Effect.asSome })),
    ),

    activeTag: pipe(
      runtime.currentVariant,
      Effect.map((current) => current.runningVariant.__polyTag__),
    ),

    currentState,

    awaitState: (predicate) =>
      pipe(
        runtime.stateChanges,
        Stream.filter(predicate),
        Stream.take(1),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      ),

    onPostForkVariant: (use) =>
      runtime.dispatch({
        [V1.V1Tag]: () =>
          Effect.die(new Error('The wallet is still running its pre-fork variant; it has not migrated')),
        [V2.V2Tag]: use,
      }),

    stop: Effect.promise(() => wallet.stop()),
  };
};
