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
 * A dust wallet registered over _both_ variants, syncing a timeline that forks under it — test scaffolding only.
 *
 * @remarks
 *   The shipped `DustWallet` registers exactly one variant and its type is a one-element HList throughout, so it cannot
 *   express a wallet that crosses a fork. Rather than widen the public surface ahead of the API redesign this builds
 *   the two-variant wallet the way `packages/e2e-tests` builds its custom wallets: `WalletBuilder.init()` with both
 *   variant builders registered directly. Nothing here is exported from the package.
 *
 *   Both sides sync through the **events** path — `makeDefaultSyncCapability`, the capability the shipped wallet uses —
 *   because that is the path the fork design is written against: its cursor is an indexer event id, which is the thing
 *   the migration parks and the replay counts on from. (The projections path cannot do any of this and says so in
 *   `Sync.ts`: a projections update is a folded snapshot with no protocol version anywhere in it, so there is nothing
 *   to split at a boundary. The simulator path could, at block granularity, but its cursor is a block number and its
 *   updates carry a live chain that only one of the two ledger versions can hold.) What is substituted is the sync
 *   _service_ on each side — the thing that would otherwise open a WebSocket to an indexer — while the capability that
 *   folds an update into the wallet, boundary rule and all, is the real one.
 *
 *   So neither side watches a chain: each is served a numbered, version-tagged event log, which is what an indexer serves
 *   and the only thing that exists after a fork anyway. The events in it are real, produced by a real ledger-v8 dust
 *   chain in `v1/test/dustEvents.ts` — recorded rather than streamed, because a wallet crossing a boundary has to be
 *   handed the same history twice, and a chain's `Event` instances are consumed the first time they are replayed.
 *
 *   Three things it has to work around, each of which is a real question the public API will have to answer eventually:
 *
 *   - **One configuration cannot carry two ledgers' dust parameters.** `WalletBuilder` intersects every variant's
 *       configuration, and both variants declare an optional `dustParameters` — each of its own ledger's
 *       `DustParameters`. Nothing objects: the two classes are structurally identical, so the intersection accepts
 *       either, and whichever is supplied is then handed to _both_ variants — one of which would be building a
 *       `DustLocalState` out of the other module's WASM object. A hazard the type system does not catch, so the field
 *       is left unset and each side is passed its own parameters directly: the pre-fork ones into the initial state,
 *       the post-fork ones into the migration.
 *   - **Start-aux does not cross the boundary.** The pre-fork variant's aux is a ledger-v8 `DustSecretKey`, the post-fork
 *       variant's a ledger-v9 one, and those two _are_ distinct to the type system — each declares a private
 *       constructor — so a single retained value provably cannot serve both. What is retained here is therefore the
 *       _seed_, and each variant is handed a key derived from it: the same dust public key either way (asserted by
 *       `forkSimulation.test.ts`), just built by the ledger that variant speaks. This is exactly what `DustWallet`'s
 *       `#retainedAux` will have to become when it is registered over two variants.
 *   - **The replay does not exist yet** when the wallet is built — it is what the indexer starts serving once the fork has
 *       happened — so it is supplied as an effect the post-fork variant awaits at its first sync.
 */

import {
  type DustParameters as PreForkParameters,
  DustSecretKey as PreForkSecretKey,
  LedgerParameters as PreForkLedgerParameters,
} from '@midnight-ntwrk/ledger-v8';
import {
  type DustParameters as PostForkParameters,
  DustSecretKey as PostForkSecretKey,
  LedgerParameters as PostForkLedgerParameters,
} from '@midnightntwrk/ledger-v9';
import { type NetworkId, type ProtocolState, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { Deferred, Effect, FiberId, Option, Stream, pipe } from 'effect';
import { CoreWallet as PreForkWallet } from '../v1/CoreWallet.js';
import { V1Tag } from '../v1/RunningV1Variant.js';
import * as PreForkSync from '../v1/Sync.js';
import { V1Builder } from '../v1/V1Builder.js';
import { type CoreWallet as PostForkWallet } from '../v2/CoreWallet.js';
import * as PostForkMigration from '../v2/Migration.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import * as PostForkSync from '../v2/Sync.js';
import { type BlockData as PostForkBlockData, WalletSyncUpdate as PostForkUpdate } from '../v2/SyncSchema.js';
import { V2Builder } from '../v2/V2Builder.js';
import { asPostForkItems, asPreForkItems, type TimelineEvent } from './forkReplay.js';

// =============================================================================
// Observation channels
// =============================================================================

/**
 * Both ends of a migration, as plain data, taken at the moment it happened.
 *
 * @remarks
 *   Recorded as plain data rather than by keeping the wallets themselves: the pre-fork state is built on the other
 *   ledger's WASM objects, whose lifetime ends with the variant scope the migration closes.
 *
 *   The `from` side is what the projection was allowed to see; the `to` side is what it produced. Under the replay design
 *   the interesting claim is on the `to` side — that a wallet crossing a fork starts with no dust at all and re-earns
 *   it by syncing, keeping only its identity and the cursor it inherited. `appliedIndex` is captured on both sides
 *   because comparing them is the only place the parked cursor is directly observable: once sync runs, a wallet that
 *   had rewound instead would read the same replay anyway and converge on the same state.
 */
export type CapturedMigration = Readonly<{
  from: Readonly<{
    dustPublicKey: bigint;
    networkId: string;
    protocolVersion: bigint;
    appliedIndex: bigint;
  }>;
  to: Readonly<{
    dustPublicKey: bigint;
    networkId: string;
    protocolVersion: bigint;
    appliedIndex: bigint;
    dustCount: number;
    pendingDustCount: number;
    commitmentTreeRoot: bigint | undefined;
    generationTreeRoot: bigint | undefined;
    /**
     * The night-to-dust ratio the produced state is parameterised by.
     *
     * @remarks
     *   Captured because it is the one thing dust's migration has to supply that shielded's does not: `DustLocalState`
     *   carries the generation and decay rates it values dust against, and they belong to whichever ledger module
     *   produced them, so the post-fork parameters are handed in rather than carried across.
     */
    nightDustRatio: bigint;
  }>;
}>;

const captureInput = (previousState: PostForkMigration.PreviousLedgerWallet): CapturedMigration['from'] => ({
  dustPublicKey: previousState.publicKey.publicKey,
  networkId: previousState.networkId,
  protocolVersion: previousState.protocolVersion,
  appliedIndex: previousState.progress.appliedIndex,
});

const captureOutput = (migrated: PostForkWallet): CapturedMigration['to'] => ({
  dustPublicKey: migrated.publicKey.publicKey,
  networkId: migrated.networkId,
  protocolVersion: migrated.protocolVersion,
  appliedIndex: migrated.progress.appliedIndex,
  dustCount: migrated.state.utxos.length,
  pendingDustCount: migrated.pendingDust.length,
  commitmentTreeRoot: migrated.state.commitmentTreeRoot(),
  generationTreeRoot: migrated.state.generatingTreeRoot(),
  nightDustRatio: migrated.state.params.nightDustRatio,
});

/** The real cross-ledger migration, with both ends recorded on the way through. */
const capturingCrossLedgerMigration = (
  dustParameters: PostForkParameters,
  captured: Deferred.Deferred<CapturedMigration>,
): PostForkMigration.StateMigration<PostForkMigration.PreviousLedgerWallet> => {
  const inner = PostForkMigration.makeCrossLedgerMigration({ dustParameters });
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
  fees: null,
});

/**
 * Transaction history reduced to nothing.
 *
 * @remarks
 *   The real services need indexer configuration or a storage instance, neither of which says anything about crossing a
 *   fork. Written out once per variant because the two `TransactionHistoryService` types name their own ledger's
 *   `DustStateChanges`.
 */
const noOpPreForkHistory = {
  put: () => Effect.void,
  getTransactionDetails: (hash: string) => Effect.succeed(transactionDetails(hash)),
};

const noOpPostForkHistory = {
  put: () => Effect.void,
  getTransactionDetails: (hash: string) => Effect.succeed(transactionDetails(hash)),
};

/**
 * Block data nothing in the proof reads.
 *
 * @remarks
 *   `blockData` serves fee estimation and transaction balancing, neither of which a fork proof exercises — but it is part
 *   of `SyncService`, so both stand-ins have to answer it. A fixed, well-formed reading is returned rather than a
 *   failure: a defect here would surface as a sync error and read like a fork that went wrong.
 */
const preForkBlockData = (timestamp: Date): PreForkSync.BlockData => ({
  hash: '',
  height: 0,
  ledgerParameters: PreForkLedgerParameters.initialParameters(),
  timestamp,
});

const postForkBlockData = (timestamp: Date): PostForkBlockData => ({
  hash: '',
  height: 0,
  ledgerParameters: PostForkLedgerParameters.initialParameters(),
  timestamp,
  zswapEndIndex: 0,
  dustCommitmentEndIndex: 0,
  dustGenerationEndIndex: 0,
  dustCommitmentMerkleTreeRoot: '',
  dustGenerationMerkleTreeRoot: '',
});

/**
 * How far back a subscription opens, given where the wallet stopped applying.
 *
 * @remarks
 *   The rule the real indexer service uses, restated over an in-memory timeline: the cursor is inclusive and must stay at
 *   or below `appliedIndex`, so a wallet already at the tip is still delivered something and its apply loop still runs.
 *   Modelled rather than skipped because it is what makes the migrated wallet's parked cursor _do_ anything: the replay
 *   is filtered against it, exactly as the indexer would filter its stream.
 */
const resumeFrom = (appliedIndex: bigint): number => Number(appliedIndex) - 1;

/**
 * The pre-fork sync service: batches of a timeline the test controls, filtered by the wallet's cursor.
 *
 * @param batches The pre-fork wire, one batch per emission — which is how a test decides whether the boundary arrives
 *   in the same batch as the history before it or in a later one.
 * @param timestamp The instant every batch is valued at, which has to be at or after the last event's block time for
 *   the dust it creates to be worth anything.
 */
const preForkSyncService = (
  batches: Stream.Stream<readonly TimelineEvent[]>,
  timestamp: Date,
): PreForkSync.SyncService<PreForkWallet, PreForkSecretKey, PreForkSync.WalletSyncUpdate> => ({
  updates: (state, secretKey) => {
    const from = resumeFrom(state.progress.appliedIndex);
    return pipe(
      batches,
      Stream.map((batch) => batch.filter((event) => event.id > from)),
      Stream.filter((batch) => batch.length > 0),
      Stream.map((batch) => PreForkSync.WalletSyncUpdate.create(asPreForkItems(batch), secretKey, timestamp)),
    );
  },
  blockData: () => Effect.succeed(preForkBlockData(timestamp)),
});

/**
 * The post-fork sync service: the indexer's replay, deferred until it exists.
 *
 * @remarks
 *   A replay that never arrives is a broken harness rather than a wallet error — there is no `WalletError` that means
 *   "the simulated replay did not happen" — so failures are raised as defects instead of being folded into the sync
 *   error channel.
 */
const postForkSyncService = (
  replayed: Effect.Effect<readonly TimelineEvent[], never>,
  timestamp: Date,
): PostForkSync.SyncService<PostForkWallet, PostForkSecretKey, PostForkUpdate> => ({
  updates: (state, secretKey) => {
    const from = resumeFrom(state.progress.appliedIndex);
    return pipe(
      replayed,
      Effect.orDie,
      Effect.map((replay) => replay.filter((event) => event.id > from)),
      Effect.map((batch) => PostForkUpdate.create(asPostForkItems(batch), secretKey, timestamp)),
      Stream.fromEffect,
    );
  },
  blockData: () => Effect.succeed(postForkBlockData(timestamp)),
});

// =============================================================================
// The wallet
// =============================================================================

/** Everything needed to build a two-variant dust wallet over a timeline that forks. */
export type ForkWalletConfig = Readonly<{
  /** The pre-fork wire, one batch per emission. */
  preFork: Stream.Stream<readonly TimelineEvent[]>;
  /** The replay — the indexer's re-emission of the timeline — which only exists once the fork has happened. */
  replayed: Effect.Effect<readonly TimelineEvent[], never>;
  networkId: NetworkId.NetworkId;
  /**
   * The version at which the post-fork variant is registered.
   *
   * The single source of truth for the boundary (D5): the pre-fork variant's activation range ends here, and so does
   * the point at which its sync stops applying. Deliberately not a production constant — the real fork version is not
   * final.
   */
  forkVersion: ProtocolVersion.ProtocolVersion;
  /** The seed both variants derive their dust key from. */
  seed: Uint8Array;
  /**
   * The dust parameters each side values dust against.
   *
   * @remarks
   *   Two of them, because `DustLocalState` is parameterised and the parameters are a WASM object of whichever ledger
   *   module produced them. Shielded's fork wallet needs no equivalent: its local state carries no parameters at all.
   */
  dustParameters: Readonly<{ preFork: PreForkParameters; postFork: PostForkParameters }>;
  /** The instant sync updates are valued at — at or after the last event's block time. */
  syncTime: Date;
}>;

/** A running two-variant dust wallet, plus the channels a fork proof needs to observe it. */
export type ForkWallet = Readonly<{
  /** A dust key of each ledger version, derived from the same seed. */
  keys: Readonly<{ preFork: PreForkSecretKey; postFork: PostForkSecretKey }>;
  /** Starts background sync, having first registered the activation watcher that restarts it after a migration. */
  start: Effect.Effect<void, WalletRuntimeError>;
  /** Resolves when the hand-over happens, with both ends of it. */
  awaitMigration: Effect.Effect<CapturedMigration>;
  /** Both ends of the migration, or `None` if none has happened yet. */
  migration: Effect.Effect<Option.Option<CapturedMigration>>;
  /** The tag of the variant currently running — `V1Tag` before a migration, `V2Tag` after one. */
  activeTag: Effect.Effect<string | symbol>;
  /** The wallet's current state, whichever variant produced it. */
  currentState: Effect.Effect<ProtocolState.ProtocolState<PreForkWallet | PostForkWallet>, WalletRuntimeError>;
  /**
   * Resolves once the wallet's state satisfies `predicate`, failing the test's timeout if it never does.
   *
   * Use monotone predicates only: the runtime's state stream keeps just the latest value, so a state that satisfies a
   * transient predicate can legitimately be skipped.
   */
  awaitState: (
    predicate: (state: ProtocolState.ProtocolState<PreForkWallet | PostForkWallet>) => boolean,
  ) => Effect.Effect<ProtocolState.ProtocolState<PreForkWallet | PostForkWallet>, WalletRuntimeError>;
  /** Tears the wallet down. */
  stop: Effect.Effect<void>;
}>;

/**
 * Builds and starts a dust wallet registered over both variants.
 *
 * @param config - The two sources, the boundary version, the network, the seed and the parameters each side values dust
 *   against.
 * @returns The running wallet and its observation channels.
 */
export const makeForkWallet = (config: ForkWalletConfig): ForkWallet => {
  const { preFork, replayed, networkId, forkVersion, seed, dustParameters, syncTime } = config;

  const preForkKey = PreForkSecretKey.fromSeed(seed);
  const postForkKey = PostForkSecretKey.fromSeed(seed);

  const captured = Deferred.unsafeMake<CapturedMigration>(FiberId.none);

  const preForkBuilder = new V1Builder()
    .withDefaultTransactionType()
    .withSync(
      () => preForkSyncService(preFork, syncTime),
      () => PreForkSync.makeDefaultSyncCapability(),
    )
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistory(() => noOpPreForkHistory)
    .withKeysDefaults()
    .withCoinSelectionDefaults();

  const postForkBuilder = new V2Builder()
    .withDefaultTransactionType()
    .withSync(
      () => postForkSyncService(replayed, syncTime),
      () => PostForkSync.makeDefaultSyncCapability(),
    )
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistory(() => noOpPostForkHistory)
    .withKeysDefaults()
    .withCoinSelectionDefaults()
    .withMigration(() => capturingCrossLedgerMigration(dustParameters.postFork, captured));

  const WalletClass = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, preForkBuilder)
    .withVariant(forkVersion, postForkBuilder)
    .build({ networkId, costParameters: { feeBlocksMargin: 5 } });

  const wallet = WalletClass.startFirst(
    WalletClass,
    PreForkWallet.initEmpty(dustParameters.preFork, preForkKey, networkId),
  );
  const runtime = wallet.runtime;

  const currentState = pipe(runtime.stateChanges, Stream.take(1), Stream.runHead, Effect.map(Option.getOrThrow));

  return {
    keys: { preFork: preForkKey, postFork: postForkKey },

    start: Effect.gen(function* () {
      // Registered before the first dispatch and only once, exactly as `DustWallet.start` does it: the returned effect
      // resolves only once the subscription is live, so the migration cannot outrun the watcher.
      yield* runtime.onVariantActivation({
        [V1Tag]: (v1) => v1.startSyncInBackground(preForkKey),
        [V2Tag]: (v2) => v2.startSyncInBackground(postForkKey),
      });
      yield* runtime.dispatch({
        [V1Tag]: (v1) => v1.startSyncInBackground(preForkKey),
        [V2Tag]: (v2) => v2.startSyncInBackground(postForkKey),
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

    stop: Effect.promise(() => wallet.stop()),
  };
};
