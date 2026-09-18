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
import { type DustParameters, LedgerParameters } from '@midnightntwrk/ledger-v9';
import { makeIndexerChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import {
  asV8DustParameters,
  CustomForkingDustWallet,
  type DefaultDustConfiguration,
  DustWallet,
  type DustWalletAPI,
  makeEventLessSyncCapability,
  makeEventLessSyncService,
} from '@midnightntwrk/wallet-sdk-dust-wallet';
import { V1Builder } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import { Migration, V2Builder } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';

/**
 * The factory shape {@link provideWallet} and the scenarios accept for the dust sub-wallet.
 *
 * Structural rather than `DustWalletClass`, so a **single-variant** composition is acceptable too. The projections
 * fast-sync is a ledger-v9 capability — it rests on `DustLocalState` members no ledger-v8 has — so a two-variant wallet
 * boots on the V1 variant, replays every event, and reaches projections only after migrating. On a chain that runs
 * ledger-v9 from its first block, a V2-only composition is the shortest way to exercise it. A start resolving
 * asynchronously is accepted for the same reason: a wallet spanning a boundary may ask the chain where it is before it
 * picks a variant.
 */
export type DustWalletFactory = (config: DefaultDustConfiguration) => {
  startWithSeed(seed: Uint8Array, dustParameters?: DustParameters): DustWalletAPI | Promise<DustWalletAPI>;
  /** Also required, because `provideWallet` restores a snapshot into whatever composition it was given. */
  restore(serializedState: string): DustWalletAPI;
};

/**
 * A dust sub-wallet that syncs from indexer projections instead of the event stream.
 *
 * The shipped `DustWallet` with exactly one substitution — the V2 variant's sync service. The V1 variant keeps the
 * event stream, because the projections sync is a ledger-v9 capability: it rests on `DustLocalState` members no
 * ledger-v8 has. On a chain that runs ledger-v9 from its first block the V1 variant never applies, so a wallet built
 * this way reaches the projections sync immediately.
 *
 * The projections sync synchronizes in finite passes rather than over a live subscription, but background
 * synchronization re-runs those passes on an interval, so this factory can be used on its own and the usual state
 * waiters behave as they do for the event-based sync. Pair it with `manualSync` — see
 * {@link manualProjectionsDustSyncOptions} — only when a caller wants to decide when each pass happens.
 *
 * **Both variants are registered, so a wallet built this way transacts.** A single-variant composition would answer for
 * the whole protocol timeline and therefore report the minimum supported version; because a facade acts at the lowest
 * version its three sub-wallets report, such a sub-wallet holds the facade below the ledger-v9 boundary and the facade
 * then refuses the shielded wallet's ledger-v9 transaction, the two sides of a boundary being unmergeable. Registering
 * both variants leaves the version to the chain, which is what lets the healthcheck scenarios pay fees and transfer
 * while syncing their Dust from projections.
 */
export const eventLessDustWallet: DustWalletFactory = (config) => {
  const dustParameters = config.dustParameters ?? LedgerParameters.initialParameters().dust;
  return CustomForkingDustWallet(
    { ...config, chainVersionProbe: config.chainVersionProbe ?? makeIndexerChainVersionProbe(config) },
    {
      builder: new V1Builder().withDefaults(),
      // The one field that cannot be shared: `dustParameters` is a WASM object of whichever ledger module produced it,
      // so the V1 variant is handed the ledger-v8 rebuild of the same rates rather than the object itself.
      configuration: { ...config, dustParameters: asV8DustParameters(dustParameters) },
    },
    {
      builder: new V2Builder()
        .withDefaults()
        .withSync(makeEventLessSyncService, makeEventLessSyncCapability)
        // Restated because `withSync` drops it: the seed-to-key derivation a start from a seed needs.
        .withStartAuxDefaults()
        .withMigration(() => Migration.makeCrossLedgerMigration({ dustParameters })),
      configuration: config,
    },
  );
};

/**
 * The event-stream dust sub-wallet, with the long-lived subscription.
 *
 * A dust snapshot stores one progress value, `appliedIndex`, and the two sync models mean different things by it: this
 * service treats it as a ledger-event cursor to resume its subscription from, while the projections service writes a
 * composite of tree indices and nullifier count. Restoring a projections-written snapshot here would therefore resume
 * the subscription from a position that is not an event id at all, and because the cursor is trusted rather than
 * validated, the effect would be silently skipped events rather than an error.
 *
 * Callers do not have to guard against that: dust snapshots are stored per sync model (see {@link dustSnapshotPath}), so
 * switching a wallet's model finds no snapshot and rebuilds from scratch instead of resuming from a cursor that is not
 * one.
 */
export const eventBasedDustWallet: DustWalletFactory = DustWallet;

/** Which of the two dust sync implementations a wallet is built with. */
export type DustSyncModel = 'events' | 'projections';

/**
 * How a dust snapshot on disk is labelled with the sync model that wrote it.
 *
 * `custom` covers a caller-supplied factory whose model cannot be identified. Giving it its own namespace is the safe
 * default: an unidentified factory then shares a snapshot with neither known model rather than with the wrong one.
 */
export type DustSnapshotModel = DustSyncModel | 'custom';

/** The dust sub-wallet factory for a sync model. */
export const dustWalletFor = (model: DustSyncModel): DustWalletFactory =>
  model === 'projections' ? eventLessDustWallet : eventBasedDustWallet;

/** The sync model a factory implements, or `custom` if it is neither of the two built-in ones. */
export const dustSyncModelOf = (factory: DustWalletFactory): DustSnapshotModel =>
  factory === eventLessDustWallet ? 'projections' : factory === eventBasedDustWallet ? 'events' : 'custom';

/** Environment variable selecting the dust sync model for a whole test run. */
export const DUST_SYNC_ENV_VAR = 'DUST_SYNC';

/**
 * Reads a dust sync model from its environment-variable spelling, falling back to `fallback` when unset or empty.
 *
 * An unrecognized value is rejected rather than defaulted. A silent fallback would mean a typo in `DUST_SYNC` reports a
 * run as covering one sync model while it actually covered the other, which is worse than not running at all.
 *
 * @throws Error if `raw` is neither empty nor a known model
 */
export const parseDustSyncModel = (raw: string | undefined, fallback: DustSyncModel = 'events'): DustSyncModel => {
  const value = raw?.trim();
  if (value === undefined || value === '') return fallback;
  if (value === 'events' || value === 'projections') return value;
  throw new Error(`${DUST_SYNC_ENV_VAR} must be 'events' or 'projections', got '${raw}'`);
};

/** The dust sync model selected by `DUST_SYNC`, or `fallback` when it is unset. */
export const dustSyncModelFromEnv = (
  env: Record<string, string | undefined> = process.env,
  fallback: DustSyncModel = 'events',
): DustSyncModel => parseDustSyncModel(env[DUST_SYNC_ENV_VAR], fallback);

/**
 * The dust sub-wallet factory selected by `DUST_SYNC`, or the one for `fallback` when it is unset.
 *
 * This is the default an explicit `dustWallet` option overrides, so a whole lane can be switched between the two sync
 * models by configuration while individual tests that need a specific model keep pinning it in code.
 *
 * `fallback` lets a caller choose which model applies when nothing is configured **without** taking the choice away
 * from `DUST_SYNC`. Passing an explicit `dustWallet` instead would pin the model outright and make the variable
 * ineffective for that wallet — which silently splits a lane, since some of its tests would switch and others would
 * not.
 */
export const dustWalletFromEnv = (
  env: Record<string, string | undefined> = process.env,
  fallback: DustSyncModel = 'events',
): DustWalletFactory => dustWalletFor(dustSyncModelFromEnv(env, fallback));

/**
 * Where the dust sub-wallet's snapshot lives, namespaced by the sync model that wrote it.
 *
 * The two models disagree on the meaning of the one progress value a snapshot carries, so a snapshot must never be
 * restored into the other model — see {@link eventBasedDustWallet}. Keeping them in separate files makes a model switch
 * degrade to a from-scratch build rather than to a wrong resume position, with no cache-clearing step to remember.
 *
 * The shielded and unshielded snapshots are model-independent and are not namespaced.
 */
export const dustSnapshotPath = (syncCacheDir: string, filename: string, model: DustSnapshotModel): string =>
  `${syncCacheDir}/dust-${model}-${filename}`;

/**
 * The projections dust sync, synchronizing in the background like the event-based sync does.
 *
 * This is the plain drop-in: spread it into the wallet options and the usual state waiters work unchanged, because
 * background synchronization re-runs the projections passes on an interval.
 *
 * Use {@link manualProjectionsDustSyncOptions} instead when a test needs to decide when each pass happens.
 */
export const projectionsDustSyncOptions: {
  readonly dustWallet: DustWalletFactory;
} = {
  dustWallet: eventLessDustWallet,
};

/**
 * The projections dust sync with background synchronization switched off, so the caller decides when each pass runs.
 *
 * Use this when a test needs passes to happen at known points — asserting on the state a specific pass produced, for
 * instance. A caller that spreads this in must drive `facade.doSync(seeds)` itself, after start and again after
 * anything that changes dust state; waiting on `waitForSyncedState()` alone will block, because with `manualSync`
 * nothing advances the dust wallet until `doSync` runs.
 *
 * For a test that just wants the wallet to keep up on its own, spread {@link projectionsDustSyncOptions} instead and let
 * background synchronization run the passes.
 */
export const manualProjectionsDustSyncOptions: {
  readonly dustWallet: DustWalletFactory;
  readonly manualSync: true;
} = {
  dustWallet: eventLessDustWallet,
  manualSync: true,
};
