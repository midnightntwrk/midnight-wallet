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
 * The shipped forking unshielded wallet, driven over an in-memory timeline, with the channels a fork proof needs.
 *
 * @remarks
 *   Everything here is observation and simulated infrastructure. The wallet itself is the one the package ships —
 *   {@link CustomForkingUnshieldedWallet}, the same composition `UnshieldedWallet(configuration)` uses — with each
 *   variant's sync _service_ replaced by a numbered, version-tagged timeline instead of a WebSocket to an indexer, and
 *   the post-fork variant's migration wrapped so both ends of the hand-over can be recorded as plain data. The
 *   capability that folds a message into the wallet, boundary rule and all, is the real one.
 *
 *   This harness is markedly simpler than the shielded and dust equivalents, and the reason is the point of the whole
 *   unshielded increment: there is no key to retain. Unshielded synchronization is watch-only — the address is public
 *   and signing is supplied per call by the caller — so `startSyncInBackground` takes no argument on either variant,
 *   the activation watcher re-dispatches with nothing, and none of the start-aux machinery those wallets need applies
 *   here. What the wallet is started with is an identity, and the harness hands it the one an application holds: the
 *   post-fork ledger version's {@link PublicKey}.
 */
import { NetworkId, type ProtocolState, type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { Deferred, Effect, FiberId, HashMap, Option, Stream, pipe } from 'effect';
import { CustomForkingUnshieldedWallet, type ForkingUnshieldedWallet } from '../ForkingUnshieldedWallet.js';
import { type PublicKey } from '../KeyStore.js';
import { type CoreWallet as PreForkWallet } from '../v1/CoreWallet.js';
import * as PreForkMigration from '../v1/Migration.js';
import * as PreForkSync from '../v1/Sync.js';
import { type WalletSyncUpdate as PreForkUpdate } from '../v1/SyncSchema.js';
import { type TransactionHistoryService as PreForkHistory } from '../v1/TransactionHistory.js';
import { V1Builder } from '../v1/V1Builder.js';
import { type CoreWallet as PostForkWallet } from '../v2/CoreWallet.js';
import * as PostForkMigration from '../v2/Migration.js';
import * as PostForkSync from '../v2/Sync.js';
import { type WalletSyncUpdate as PostForkUpdate } from '../v2/SyncSchema.js';
import { type TransactionHistoryService as PostForkHistory } from '../v2/TransactionHistory.js';
import { V2Builder } from '../v2/V2Builder.js';
import { type TimelineItem } from './forkTimeline.js';

// =============================================================================
// Observation channels
// =============================================================================

/**
 * A migration captured as plain data.
 *
 * @remarks
 *   Captured rather than inspected live so assertions can be made after the crossing, when the pre-fork variant's scope
 *   has closed.
 */
export type CapturedMigration = {
  readonly from: MigrationSide;
  readonly to: MigrationSide;
};

/** The version-agnostic view of a wallet either side of the boundary. */
export type MigrationSide = {
  readonly utxos: readonly CarriedUtxo[];
  readonly appliedId: bigint;
  readonly protocolVersion: bigint;
  readonly networkId: string;
  readonly address: string;
};

/** A UTXO as plain data, comparable across the two ledger versions. */
export type CarriedUtxo = {
  readonly value: bigint;
  readonly owner: string;
  readonly type: string;
  readonly intentHash: string;
  readonly outputNo: number;
  readonly ctime: number;
};

const sideOf = (wallet: PreForkWallet | PostForkWallet): MigrationSide => ({
  utxos: utxosOf(wallet),
  appliedId: wallet.progress.appliedId,
  protocolVersion: wallet.protocolVersion,
  networkId: wallet.networkId,
  address: wallet.publicKey.address,
});

/** A held UTXO reduced to plain data, comparable across the two ledger versions. */
const plainUtxo = (held: {
  readonly utxo: {
    readonly value: bigint;
    readonly owner: string;
    readonly type: string;
    readonly intentHash: string;
    readonly outputNo: number;
  };
  readonly meta: { readonly ctime: Date };
}): CarriedUtxo => ({
  value: held.utxo.value,
  owner: held.utxo.owner,
  type: held.utxo.type,
  intentHash: held.utxo.intentHash,
  outputNo: held.utxo.outputNo,
  ctime: held.meta.ctime.getTime(),
});

const sortedCarried = (utxos: readonly CarriedUtxo[]): readonly CarriedUtxo[] =>
  [...utxos].sort((a, b) => (a.value === b.value ? a.outputNo - b.outputNo : Number(a.value - b.value)));

/** Every available UTXO, as plain data, in a stable order so two sides can be compared directly. */
export const utxosOf = (wallet: PreForkWallet | PostForkWallet): readonly CarriedUtxo[] =>
  sortedCarried(Array.from(HashMap.values(wallet.state.availableUtxos), plainUtxo));

/** Wraps the real cross-ledger migration so the test can see exactly what crossed. */
const capturingCrossLedgerMigration = (
  captured: Deferred.Deferred<CapturedMigration>,
): PostForkMigration.StateMigration<PostForkMigration.PreviousLedgerWallet> => {
  const inner = PostForkMigration.makeCrossLedgerMigration();
  return {
    migrate: (previousState) =>
      pipe(
        inner.migrate(previousState),
        Effect.tap((migrated) =>
          Deferred.succeed(captured, {
            from: {
              utxos: sortedCarried(Array.from(HashMap.values(previousState.state.availableUtxos), plainUtxo)),
              appliedId: previousState.progress.appliedId,
              protocolVersion: previousState.protocolVersion,
              networkId: previousState.networkId,
              address: previousState.publicKey.address,
            },
            to: sideOf(migrated),
          }),
        ),
      ),
  };
};

// =============================================================================
// Stand-ins for services the proof does not exercise
// =============================================================================

/**
 * Transaction history reduced to nothing.
 *
 * @remarks
 *   The real service needs an indexer connection and a storage instance, neither of which says anything about crossing a
 *   fork. Written out once per variant because the two `TransactionHistoryService` types name their own ledger
 *   version's update.
 */
const noOpPreForkHistory: PreForkHistory = { put: () => Effect.void };
const noOpPostForkHistory: PostForkHistory = { put: () => Effect.void };

/** What each variant is configured with, on top of what its builder already asks for. */
type SourceConfiguration = Readonly<{
  networkId: NetworkId.NetworkId;
  /** The single timeline both variants read, each decoding it as its own ledger version's update. */
  timeline: readonly TimelineItem[];
}>;

/**
 * A sync service over an in-memory timeline, honouring the wallet's cursor.
 *
 * @remarks
 *   This is the whole fidelity of the model, and it is deliberately the one thing not stubbed away: the source is asked
 *   for everything _after_ the cursor the wallet presents, exactly as the indexer subscription is
 *   (`subscription(transactionId: appliedId)`). A post-fork variant that resumes from a parked cursor therefore really
 *   does re-fetch the boundary transaction, and one that resumed from a bumped cursor really would miss it.
 */
const timelineSyncService = <TUpdate>(
  timeline: readonly TimelineItem[],
  toUpdate: (item: TimelineItem) => TUpdate,
) => ({
  updates: (state: PreForkWallet | PostForkWallet) =>
    Stream.fromIterable(timeline.filter((item) => BigInt(item.id) > state.progress.appliedId).map(toUpdate)),
});

// =============================================================================
// The wallet
// =============================================================================

/** Everything needed to point the shipped forking unshielded wallet at a timeline that forks. */
export type ForkWalletConfig = {
  /** The single timeline both variants read, each decoding it as its own ledger version's update. */
  readonly timeline: readonly TimelineItem[];
  /**
   * The version at which the post-fork variant is registered.
   *
   * The single source of truth for the boundary: the pre-fork variant's activation range ends here, and so does the
   * point at which its sync stops applying. Deliberately not a production constant — the real fork version is not
   * final.
   */
  readonly forkVersion: ProtocolVersion.ProtocolVersion;
  /** The identity the wallet is started with, in the shape an application holds it: the post-fork ledger version's. */
  readonly publicKey: PublicKey;
  readonly networkId?: NetworkId.NetworkId;
};

/** A state emission, whichever variant produced it. */
export type ForkedState = ProtocolState.ProtocolState<PreForkWallet | PostForkWallet>;

/** A running forking unshielded wallet, plus the channels a fork proof needs to observe it. */
export type ForkWallet = {
  /** The wallet itself, exactly as an application would hold it. */
  readonly unshielded: ForkingUnshieldedWallet<PreForkUpdate, PostForkUpdate>;
  /** Starts background synchronization through the wallet's own API. */
  readonly start: Effect.Effect<void>;
  /** Resolves when the hand-over happens, with both ends of it. */
  readonly awaitMigration: Effect.Effect<CapturedMigration>;
  /** Both ends of the migration, or `None` if none has happened yet. */
  readonly migration: Effect.Effect<Option.Option<CapturedMigration>>;
  /** The tag of the variant currently running — `V1Tag` before a migration, `V2Tag` after one. */
  readonly activeTag: Effect.Effect<string | symbol>;
  /** The wallet's current state, whichever variant produced it. */
  readonly currentState: Effect.Effect<ForkedState, WalletRuntimeError>;
  /**
   * Resolves once the wallet's state satisfies `predicate`, failing the test's timeout if it never does.
   *
   * Use monotone predicates only: the runtime's state stream keeps just the latest value, so a state that satisfies a
   * transient predicate can legitimately be skipped.
   */
  readonly awaitState: (predicate: (state: ForkedState) => boolean) => Effect.Effect<ForkedState, WalletRuntimeError>;
  /** Tears the wallet down. */
  readonly stop: Effect.Effect<void>;
};

/**
 * Builds and starts the shipped forking unshielded wallet over an in-memory timeline that forks.
 *
 * @param config The timeline, the boundary version and the identity to start with.
 * @returns The running wallet and its observation channels.
 */
export const makeForkWallet = (config: ForkWalletConfig): ForkWallet => {
  const networkId = config.networkId ?? NetworkId.NetworkId.Undeployed;
  const captured = Deferred.unsafeMake<CapturedMigration>(FiberId.none);
  const variantConfiguration: SourceConfiguration = { networkId, timeline: config.timeline };

  const preForkBuilder = new V1Builder()
    .withSync(
      (configuration: SourceConfiguration) =>
        timelineSyncService<PreForkUpdate>(configuration.timeline, (item) => item.update as PreForkUpdate),
      // The REAL capability, boundary rule and all — only the service that would open a WebSocket is substituted.
      (_configuration: SourceConfiguration, getContext: () => { transactionHistoryService: PreForkHistory }) =>
        PreForkSync.makeDefaultSyncCapability({ indexerClientConnection: { indexerHttpUrl: 'http://unused' } }, () =>
          getContext(),
        ),
    )
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withSigningDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistory(() => noOpPreForkHistory)
    .withKeysDefaults()
    .withCoinSelectionDefaults()
    .withMigration((configuration: SourceConfiguration) =>
      PreForkMigration.makeEmptyWalletMigration({ networkId: configuration.networkId }),
    );

  const postForkBuilder = new V2Builder()
    .withSync(
      (configuration: SourceConfiguration) =>
        timelineSyncService<PostForkUpdate>(configuration.timeline, (item) => item.update as PostForkUpdate),
      (_configuration: SourceConfiguration, getContext: () => { transactionHistoryService: PostForkHistory }) =>
        PostForkSync.makeDefaultSyncCapability({ indexerClientConnection: { indexerHttpUrl: 'http://unused' } }, () =>
          getContext(),
        ),
    )
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withSigningDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistory(() => noOpPostForkHistory)
    .withKeysDefaults()
    .withCoinSelectionDefaults()
    .withMigration(() => capturingCrossLedgerMigration(captured));

  const WalletClass = CustomForkingUnshieldedWallet(
    { networkId, forkVersion: config.forkVersion },
    { builder: preForkBuilder, configuration: variantConfiguration },
    { builder: postForkBuilder, configuration: variantConfiguration },
  );

  const wallet = WalletClass.startWithPublicKey(config.publicKey);
  const runtime = wallet.runtime;

  return {
    unshielded: wallet,

    start: Effect.promise(() => wallet.start()),

    awaitMigration: Deferred.await(captured),

    migration: Deferred.poll(captured).pipe(
      Effect.flatMap(Option.match({ onNone: () => Effect.succeedNone, onSome: Effect.asSome })),
    ),

    activeTag: pipe(
      runtime.currentVariant,
      Effect.map((current) => current.runningVariant.__polyTag__),
    ),

    currentState: pipe(runtime.stateChanges, Stream.take(1), Stream.runHead, Effect.map(Option.getOrThrow)),

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
