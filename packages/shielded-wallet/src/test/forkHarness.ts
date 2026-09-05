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
 * The shipped forking shielded wallet, driven over simulated chains, with the channels a fork proof needs to watch it.
 *
 * @remarks
 *   Everything here is observation and simulated infrastructure. The wallet itself is the one the package ships —
 *   {@link CustomForkingShieldedWallet}, the same composition `ShieldedWallet(configuration)` uses — with each variant
 *   pointed at a simulated chain instead of an indexer, and the post-fork variant's migration wrapped so both ends of
 *   the hand-over can be recorded as plain data.
 *
 *   The two sides read different sources, which is the shape the real thing has: before the fork the pre-fork chain,
 *   after it the chain the fork left behind — the one holding the translated state, which re-announces nothing (see
 *   `translationStub.ts`). The post-fork source does not exist when the wallet is built — the fork has not happened yet
 *   — so it reaches its variant as an effect awaited at the first sync, carried in that variant's own configuration.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { type NetworkId, type ProtocolState, type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import {
  type LedgerTranslationError,
  type Simulator,
  type V8,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { Deferred, Effect, FiberId, Option, Stream, pipe } from 'effect';
import {
  CustomForkingShieldedWallet,
  type ForkingShieldedWallet,
  type ForkingShieldedWalletClass,
} from '../ShieldedWallet.js';
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
 *   The `from` side is what the migration was allowed to see; the `to` side is what it produced. The interesting claim is
 *   on the `to` side, and it is that the crossing is complete the moment it happens: the local state arrives whole —
 *   its coins at the indices the chain gave them, its height, and the outputs it was still expecting — because nothing
 *   on the other side will ever announce any of it again. `coinHashCount` and `coinHashesPending` are the one
 *   exception, and the only thing left for sync to finish: hashes are derived from the secret keys, which a migration
 *   by design does not hold.
 *
 *   `appliedIndex` is captured on both sides because comparing them is where the parked cursor is directly observable:
 *   the post-fork timeline continues the indexer's event ids rather than restarting them, so a migration that rewound
 *   to zero would leave the wallet waiting on a stretch of history this ledger version's events do not occupy.
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
    /** The outputs the wallet was still expecting — the part of what it owns that no chain re-announces. */
    pendingOutputCount: number;
    coinHashCount: number;
    /** Whether the hashes are still to be computed, which they are until the first sync update supplies the keys. */
    coinHashesPending: boolean;
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
  pendingOutputCount: migrated.state.pendingOutputs.size,
  coinHashCount: Object.keys(migrated.coinHashes).length,
  coinHashesPending: migrated.coinHashesPending === true,
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

/** What the post-fork variant is configured with: a source that does not exist yet. */
type DeferredSourceConfiguration = Readonly<{
  networkId: NetworkId.NetworkId;
  postFork: Effect.Effect<Simulator, LedgerTranslationError>;
}>;

/**
 * The post-fork sync source, deferred until the fork produces it.
 *
 * @remarks
 *   A source that never arrives — or a translation that failed — is a broken harness rather than a wallet error; there is
 *   no `WalletError` that means "the simulated fork did not happen". So failures are raised as defects instead of being
 *   folded into the sync error channel, where the variant's retry would quietly absorb them.
 */
const postForkSyncService = (
  configuration: DeferredSourceConfiguration,
): V2.Sync.SyncService<V2.CoreWallet, v9.ZswapSecretKeys, V2.Sync.SimulatorSyncUpdate> => ({
  updates: (state, secretKeys) =>
    Stream.unwrap(
      pipe(
        configuration.postFork,
        Effect.orDie,
        Effect.map((chain) => V2.Sync.makeSimulatorSyncService({ simulator: chain }).updates(state, secretKeys)),
      ),
    ),
});

// =============================================================================
// The wallet
// =============================================================================

/** Everything needed to point a forking shielded wallet at a chain that forks. */
export type ForkWalletConfig = Readonly<{
  /** The pre-fork chain, available immediately. */
  preFork: V8.Simulator;
  /**
   * The post-fork source — the chain carrying the translated state — which only exists once the fork has happened.
   *
   * It re-announces nothing: everything the wallet owned before the boundary is already in the tree its genesis block
   * holds, which is why a crossing wallet has to arrive holding its own state.
   */
  postFork: Effect.Effect<Simulator, LedgerTranslationError>;
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
  /**
   * Which class-level start the wallet is built through.
   *
   * Absent means the seed, which is what every proof here wants unless the escape hatch itself is the subject: a wallet
   * built from `startWithKeys` holds the same two key objects a seed would have derived, and nothing else about it
   * differs.
   */
  startFrom?: 'seed' | 'keys';
  /**
   * How the wallet asks the chain which protocol version it is on before choosing a variant to start at.
   *
   * Absent means it does not ask, which is the behaviour of every wallet built without one: it starts at the head
   * variant and learns the version from the first event it sees.
   */
  chainVersionProbe?: ChainVersionProbe;
}>;

/** A state emission, whichever variant produced it. */
export type ForkedState = ProtocolState.ProtocolState<V1.CoreWallet | V2.CoreWallet>;

/** A running forking shielded wallet, plus the channels a fork proof needs to observe it. */
export type ForkWallet = Readonly<{
  /** The wallet itself, exactly as an application would hold it. */
  shielded: ForkingShieldedWallet<V1.Sync.SimulatorSyncUpdate, V2.Sync.SimulatorSyncUpdate>;
  /**
   * The class the wallet was started from, so a snapshot can be restored through the same registration that wrote it.
   *
   * @remarks
   *   Restoring is a class-level entry point, not an instance one — it is how an application gets a wallet in the first
   *   place — so a proof about restoring needs the class and not merely the running wallet.
   */
  walletClass: ForkingShieldedWalletClass<V1.Sync.SimulatorSyncUpdate, V2.Sync.SimulatorSyncUpdate>;
  /** Keys of each ledger version, derived from the same seed. */
  keys: Readonly<{ preFork: v8.ZswapSecretKeys; postFork: v9.ZswapSecretKeys }>;
  /** Starts background sync through the wallet's own API, which resolves the key material each variant can use. */
  start: Effect.Effect<void>;
  /** Resolves when the hand-over happens, with both ends of it. */
  awaitMigration: Effect.Effect<CapturedMigration>;
  /** Both ends of the migration, or `None` if none has happened yet. */
  migration: Effect.Effect<Option.Option<CapturedMigration>>;
  /** The tag of the variant currently running — `V1Tag` before a migration, `V2Tag` after one. */
  activeTag: Effect.Effect<string | symbol>;
  /** The wallet's current state, whichever variant produced it. */
  currentState: Effect.Effect<ForkedState, WalletRuntimeError>;
  /**
   * Resolves once the wallet's state satisfies `predicate`, failing the test's timeout if it never does.
   *
   * Use monotone predicates only: the runtime's state stream keeps just the latest value, so a state that satisfies a
   * transient predicate can legitimately be skipped.
   */
  awaitState: (predicate: (state: ForkedState) => boolean) => Effect.Effect<ForkedState, WalletRuntimeError>;
  /** Tears the wallet down. */
  stop: Effect.Effect<void>;
}>;

/**
 * Builds and starts the shipped forking shielded wallet over two simulated chains.
 *
 * @remarks
 *   Effectful because starting one is: a wallet that spans a boundary may ask the chain which version it is on before it
 *   can choose a variant, and that question is answered over the network. A harness that hid it behind a synchronous
 *   call would be hiding the very thing these proofs are about.
 * @param config - The two sources, the boundary version, the network, the seed, and how the chain is asked its version.
 * @returns The running wallet and its observation channels.
 */
export const makeForkWallet = (config: ForkWalletConfig): Effect.Effect<ForkWallet> => {
  const { preFork, postFork, networkId, forkVersion, seed, startFrom, chainVersionProbe } = config;

  const preForkKeys = v8.ZswapSecretKeys.fromSeed(seed);
  const postForkKeys = v9.ZswapSecretKeys.fromSeed(seed);

  const captured = Deferred.unsafeMake<CapturedMigration>(FiberId.none);

  const preForkBuilder = new V1.V1Builder()
    .withDefaultTransactionType()
    .withSync(V1.Sync.makeSimulatorSyncService, V1.Sync.makeSimulatorSyncCapability)
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistory(() => noOpPreForkHistory)
    .withKeysDefaults()
    .withStartAuxDefaults()
    .withCoinSelectionDefaults();

  const postForkBuilder = new V2.V2Builder()
    .withDefaultTransactionType()
    .withSync(postForkSyncService, V2.Sync.makeSimulatorSyncCapability)
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistory(() => noOpPostForkHistory)
    .withKeysDefaults()
    .withStartAuxDefaults()
    .withCoinSelectionDefaults()
    .withMigration(() => capturingCrossLedgerMigration(captured));

  const WalletClass = CustomForkingShieldedWallet(
    { networkId, forks: { v9: forkVersion }, ...(chainVersionProbe !== undefined ? { chainVersionProbe } : {}) },
    { builder: preForkBuilder, configuration: { networkId, simulator: preFork } },
    { builder: postForkBuilder, configuration: { networkId, postFork } },
  );

  return Effect.promise(() =>
    startFrom === 'keys'
      ? WalletClass.startWithKeys({ v8: preForkKeys, v9: postForkKeys })
      : WalletClass.startWithSeed(seed),
  ).pipe(
    Effect.map((wallet) => {
      const runtime = wallet.runtime;

      const currentState = pipe(runtime.stateChanges, Stream.take(1), Stream.runHead, Effect.map(Option.getOrThrow));

      return {
        shielded: wallet,

        walletClass: WalletClass,

        keys: { preFork: preForkKeys, postFork: postForkKeys },

        // The keys handed over are the post-fork ledger version's, which is what the wallet's API speaks. The pre-fork
        // variant running underneath is started from the seed the wallet retained instead — the seam a wallet crossing
        // a boundary rests on.
        start: Effect.promise(() => wallet.start(postForkKeys)),

        awaitMigration: Deferred.await(captured),

        migration: Deferred.poll(captured).pipe(
          Effect.flatMap(Option.match({ onNone: () => Effect.succeedNone, onSome: Effect.asSome })),
        ),

        activeTag: pipe(
          runtime.currentVariant,
          Effect.map((current) => current.runningVariant.__polyTag__),
        ),

        currentState,

        awaitState: (predicate: (state: ForkedState) => boolean) =>
          pipe(
            runtime.stateChanges,
            Stream.filter(predicate),
            Stream.take(1),
            Stream.runHead,
            Effect.map(Option.getOrThrow),
          ),

        stop: Effect.promise(() => wallet.stop()),
      };
    }),
  );
};
