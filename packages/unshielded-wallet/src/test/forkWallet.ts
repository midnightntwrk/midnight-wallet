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
//
// A test-only unshielded wallet registered over BOTH variants, so a crossing can actually be driven.
//
// The shipped `UnshieldedWallet` registers exactly one variant and is typed as a one-element HList throughout, so it
// cannot express a fork-crossing wallet. Rather than widen the public surface ahead of the API redesign, this builds the
// two-variant wallet the way `packages/e2e-tests` builds its custom wallets: `WalletBuilder.init()` with both variant
// builders registered directly. Nothing here is exported from the package.
//
// This factory is markedly simpler than the shielded and dust equivalents, and the reason is the point of the whole
// unshielded increment: there is no key to retain. Unshielded sync is watch-only — the address is public and signing is
// supplied per call by the caller — so `startSyncInBackground` takes no argument, the activation watcher re-dispatches
// with nothing, and none of the start-aux workarounds those factories document apply here.
import { NetworkId, ProtocolVersion, type ProtocolState } from '@midnightntwrk/wallet-sdk-abstractions';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import { Deferred, Effect, FiberId, HashMap, Option, Stream, pipe } from 'effect';
import { V1Builder, V1Tag, type CoreWallet as PreForkWallet } from '../v1/index.js';
import * as PreForkSync from '../v1/Sync.js';
import * as PreForkMigration from '../v1/Migration.js';
import { V2Builder, V2Tag, type CoreWallet as PostForkWallet } from '../v2/index.js';
import * as PostForkSync from '../v2/Sync.js';
import * as PostForkMigration from '../v2/Migration.js';
import { type TransactionHistoryService as PreForkHistory } from '../v1/TransactionHistory.js';
import { type TransactionHistoryService as PostForkHistory } from '../v2/TransactionHistory.js';
import { type WalletSyncUpdate as PreForkUpdate } from '../v1/SyncSchema.js';
import { type WalletSyncUpdate as PostForkUpdate } from '../v2/SyncSchema.js';
import { type TimelineItem } from './forkTimeline.js';

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

const noOpPreForkHistory: PreForkHistory = { put: () => Effect.void };
const noOpPostForkHistory: PostForkHistory = { put: () => Effect.void };

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

export type ForkWalletConfig = {
  /** The single timeline both variants read, each decoding it as its own ledger version's update. */
  readonly timeline: readonly TimelineItem[];
  /** The protocol version at which the second variant takes over. */
  readonly forkVersion: ProtocolVersion.ProtocolVersion;
  /** The wallet's starting state, built on the pre-fork ledger version. */
  readonly initialState: PreForkWallet;
  readonly networkId?: NetworkId.NetworkId;
};

export type ForkWallet = {
  readonly start: Effect.Effect<void, WalletRuntimeError>;
  readonly awaitMigration: Effect.Effect<CapturedMigration>;
  readonly migration: Effect.Effect<Option.Option<CapturedMigration>>;
  readonly activeTag: Effect.Effect<string | symbol>;
  readonly currentState: Effect.Effect<ProtocolState.ProtocolState<PreForkWallet | PostForkWallet>, WalletRuntimeError>;
  readonly awaitState: (
    predicate: (state: ProtocolState.ProtocolState<PreForkWallet | PostForkWallet>) => boolean,
  ) => Effect.Effect<ProtocolState.ProtocolState<PreForkWallet | PostForkWallet>, WalletRuntimeError>;
  readonly stop: Effect.Effect<void>;
};

/**
 * Builds and starts an unshielded wallet registered over both variants.
 *
 * @param config The timeline, the boundary version and the starting state.
 * @returns The running wallet and its observation channels.
 */
export const makeForkWallet = (config: ForkWalletConfig): ForkWallet => {
  const networkId = config.networkId ?? NetworkId.NetworkId.Undeployed;
  const captured = Deferred.unsafeMake<CapturedMigration>(FiberId.none);

  const preForkBuilder = new V1Builder()
    .withSync(
      () => timelineSyncService<PreForkUpdate>(config.timeline, (item) => item.update as PreForkUpdate),
      // The REAL capability, boundary rule and all — only the service that would open a WebSocket is substituted.
      (_c: object, getContext: () => { transactionHistoryService: PreForkHistory }) =>
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
    .withMigration(() => PreForkMigration.makeEmptyWalletMigration({ networkId }));

  const postForkBuilder = new V2Builder()
    .withSync(
      () => timelineSyncService<PostForkUpdate>(config.timeline, (item) => item.update as PostForkUpdate),
      (_c: object, getContext: () => { transactionHistoryService: PostForkHistory }) =>
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

  const WalletClass = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, preForkBuilder)
    .withVariant(config.forkVersion, postForkBuilder)
    .build({ networkId });

  const wallet = WalletClass.startFirst(WalletClass, config.initialState);
  const runtime = wallet.runtime;

  return {
    start: Effect.gen(function* () {
      // Registered before the first dispatch and only once, exactly as `UnshieldedWallet.start` does it — and with no
      // argument, which is the point: nothing secret has to survive the crossing.
      yield* runtime.onVariantActivation({
        [V1Tag]: (v1) => v1.startSyncInBackground(),
        [V2Tag]: (v2) => v2.startSyncInBackground(),
      });
      yield* runtime.dispatch({
        [V1Tag]: (v1) => v1.startSyncInBackground(),
        [V2Tag]: (v2) => v2.startSyncInBackground(),
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
