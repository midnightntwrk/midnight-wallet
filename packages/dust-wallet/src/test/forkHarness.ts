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
 * The shipped forking dust wallet, driven over an in-memory timeline, with the channels a fork proof needs to watch it.
 *
 * @remarks
 *   Everything here is observation and simulated infrastructure. The wallet itself is the one the package ships —
 *   {@link CustomForkingDustWallet}, the same composition `DustWallet(configuration)` uses — with each variant's sync
 *   _service_ replaced by a numbered, version-tagged event log instead of a WebSocket to an indexer, and the post-fork
 *   variant's migration wrapped so both ends of the hand-over can be recorded as plain data. The capability that folds
 *   an update into the wallet, boundary rule and all, is the real one.
 *
 *   Both sides sync through the **events** path, because that is the path the fork design is written against: its cursor
 *   is an indexer event id, which is the thing the migration parks and the replay counts on from. (The projections path
 *   cannot do any of this and says so in `v2/Sync.ts`: a projections update is a folded snapshot with no protocol
 *   version anywhere in it, so there is nothing to split at a boundary.)
 *
 *   So neither side watches a chain: each is served a numbered, version-tagged event log, which is what an indexer serves
 *   and the only thing that exists after a fork anyway. The events in it are real, produced by a real ledger-v8 dust
 *   chain in `v1/test/dustEvents.ts` — recorded rather than streamed, because a wallet crossing a boundary has to be
 *   handed the same history twice.
 *
 *   The post-fork source does not exist when the wallet is built — the replay only happens once the fork has — so it
 *   reaches its variant as an effect awaited at the first sync, carried in that variant's own configuration.
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
import { type NetworkId, type ProtocolState, type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { Deferred, Effect, FiberId, Option, Stream, pipe } from 'effect';
import { CustomForkingDustWallet, type ForkingDustWallet, type ForkingDustWalletClass } from '../DustWallet.js';
import { type CoreWallet as PreForkWallet } from '../v1/CoreWallet.js';
import * as PreForkSync from '../v1/Sync.js';
import { V1Builder } from '../v1/V1Builder.js';
import { type CoreWallet as PostForkWallet } from '../v2/CoreWallet.js';
import * as PostForkMigration from '../v2/Migration.js';
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
  protocolVersion: 0,
  ledgerParameters: PreForkLedgerParameters.initialParameters(),
  timestamp,
});

const postForkBlockData = (timestamp: Date): PostForkBlockData => ({
  hash: '',
  height: 0,
  protocolVersion: 0,
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

/** What the pre-fork variant is configured with, on top of what its builder already asks for. */
type PreForkSourceConfiguration = Readonly<{
  /** The pre-fork wire, one batch per emission. */
  batches: Stream.Stream<readonly TimelineEvent[]>;
  /** The instant every batch is valued at, which has to be at or after the last event's block time. */
  syncTime: Date;
}>;

/** What the post-fork variant is configured with: a source that does not exist yet. */
type PostForkSourceConfiguration = Readonly<{
  /** The replay — the indexer's re-emission of the timeline — which only exists once the fork has happened. */
  replayed: Effect.Effect<readonly TimelineEvent[], never>;
  syncTime: Date;
}>;

/** The pre-fork sync service: batches of a timeline the test controls, filtered by the wallet's cursor. */
const preForkSyncService = (
  configuration: PreForkSourceConfiguration,
): PreForkSync.SyncService<PreForkWallet, PreForkSecretKey, PreForkSync.WalletSyncUpdate> => ({
  updates: (state, secretKey) => {
    const from = resumeFrom(state.progress.appliedIndex);
    return pipe(
      configuration.batches,
      Stream.map((batch) => batch.filter((event) => event.id > from)),
      Stream.filter((batch) => batch.length > 0),
      Stream.map((batch) =>
        PreForkSync.WalletSyncUpdate.create(asPreForkItems(batch), secretKey, configuration.syncTime),
      ),
    );
  },
  blockData: () => Effect.succeed(preForkBlockData(configuration.syncTime)),
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
  configuration: PostForkSourceConfiguration,
): PostForkSync.SyncService<PostForkWallet, PostForkSecretKey, PostForkUpdate> => ({
  updates: (state, secretKey) => {
    const from = resumeFrom(state.progress.appliedIndex);
    return pipe(
      configuration.replayed,
      Effect.orDie,
      Effect.map((replay) => replay.filter((event) => event.id > from)),
      Effect.map((batch) => PostForkUpdate.create(asPostForkItems(batch), secretKey, configuration.syncTime)),
      Stream.fromEffect,
    );
  },
  blockData: () => Effect.succeed(postForkBlockData(configuration.syncTime)),
});

// =============================================================================
// The wallet
// =============================================================================

/** Everything needed to point the shipped forking dust wallet at a timeline that forks. */
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
   * Which class-level start the wallet is built through.
   *
   * Absent means the seed, which is what every proof here wants unless the escape hatch itself is the subject: a wallet
   * built from `startWithKeys` holds the same two dust keys a seed would have derived, and nothing else about it
   * differs.
   */
  startFrom?: 'seed' | 'keys';
  /**
   * The dust parameters each side values dust against.
   *
   * @remarks
   *   Two of them, because `DustLocalState` is parameterised and the parameters are a WASM object of whichever ledger
   *   module produced them. The shipped wallet rebuilds the pre-fork set from the post-fork one it is handed; this
   *   harness states both so a proof can assert what the migration was given.
   */
  dustParameters: Readonly<{ preFork: PreForkParameters; postFork: PostForkParameters }>;
  /** The instant sync updates are valued at — at or after the last event's block time. */
  syncTime: Date;
  /**
   * How the wallet asks the chain which protocol version it is on before choosing a variant to start at.
   *
   * Absent means it does not ask, which is the behaviour of every wallet built without one: it starts at the head
   * variant and learns the version from the first event it sees.
   */
  chainVersionProbe?: ChainVersionProbe;
}>;

/** A state emission, whichever variant produced it. */
export type ForkedState = ProtocolState.ProtocolState<PreForkWallet | PostForkWallet>;

/** A running forking dust wallet, plus the channels a fork proof needs to observe it. */
export type ForkWallet = Readonly<{
  /** The wallet itself, exactly as an application would hold it. */
  dust: ForkingDustWallet<PreForkSync.WalletSyncUpdate, PostForkUpdate>;
  /**
   * The class the wallet was started from, so a snapshot can be restored through the same registration that wrote it.
   *
   * @remarks
   *   Restoring is a class-level entry point, not an instance one — it is how an application gets a wallet in the first
   *   place — so a proof about restoring needs the class and not merely the running wallet.
   */
  walletClass: ForkingDustWalletClass<PreForkSync.WalletSyncUpdate, PostForkUpdate>;
  /** A dust key of each ledger version, derived from the same seed. */
  keys: Readonly<{ preFork: PreForkSecretKey; postFork: PostForkSecretKey }>;
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
 * Builds and starts the shipped forking dust wallet over an in-memory timeline that forks.
 *
 * @remarks
 *   Effectful because starting one is: a wallet that spans a boundary may ask the chain which version it is on before it
 *   can choose a variant, and that question is answered over the network. A harness that hid it behind a synchronous
 *   call would be hiding the very thing these proofs are about.
 * @param config - The two sources, the boundary version, the network, the seed, the parameters each side values dust
 *   against, and how the chain is asked its version.
 * @returns The running wallet and its observation channels.
 */
export const makeForkWallet = (config: ForkWalletConfig): Effect.Effect<ForkWallet> => {
  const { preFork, replayed, networkId, forkVersion, seed, startFrom, dustParameters, syncTime, chainVersionProbe } =
    config;

  const preForkKey = PreForkSecretKey.fromSeed(seed);
  const postForkKey = PostForkSecretKey.fromSeed(seed);

  const captured = Deferred.unsafeMake<CapturedMigration>(FiberId.none);

  const preForkBuilder = new V1Builder()
    .withDefaultTransactionType()
    .withSync(preForkSyncService, () => PreForkSync.makeDefaultSyncCapability())
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistory(() => noOpPreForkHistory)
    .withKeysDefaults()
    .withStartAuxDefaults()
    .withCoinSelectionDefaults();

  const postForkBuilder = new V2Builder()
    .withDefaultTransactionType()
    .withSync(postForkSyncService, () => PostForkSync.makeDefaultSyncCapability())
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistory(() => noOpPostForkHistory)
    .withKeysDefaults()
    .withStartAuxDefaults()
    .withCoinSelectionDefaults()
    .withMigration(() => capturingCrossLedgerMigration(dustParameters.postFork, captured));

  const WalletClass = CustomForkingDustWallet(
    { networkId, forks: { v9: forkVersion }, ...(chainVersionProbe !== undefined ? { chainVersionProbe } : {}) },
    {
      builder: preForkBuilder,
      configuration: {
        networkId,
        costParameters: { feeBlocksMargin: 5 },
        dustParameters: dustParameters.preFork,
        batches: preFork,
        syncTime,
      },
    },
    {
      builder: postForkBuilder,
      configuration: {
        networkId,
        costParameters: { feeBlocksMargin: 5 },
        dustParameters: dustParameters.postFork,
        replayed,
        syncTime,
      },
    },
  );

  return Effect.promise(() =>
    startFrom === 'keys'
      ? WalletClass.startWithKeys({ v8: preForkKey, v9: postForkKey }, dustParameters.postFork)
      : WalletClass.startWithSeed(seed, dustParameters.postFork),
  ).pipe(
    Effect.map((wallet) => {
      const runtime = wallet.runtime;

      const currentState = pipe(runtime.stateChanges, Stream.take(1), Stream.runHead, Effect.map(Option.getOrThrow));

      return {
        dust: wallet,

        walletClass: WalletClass,

        keys: { preFork: preForkKey, postFork: postForkKey },

        // The key handed over is the post-fork ledger version's, which is what the wallet's API speaks. The pre-fork
        // variant running underneath is started from the seed the wallet retained instead — the seam a wallet crossing
        // a boundary rests on.
        start: Effect.promise(() => wallet.start(postForkKey)),

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
