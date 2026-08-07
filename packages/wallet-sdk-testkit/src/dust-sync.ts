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
import {
  CustomDustWallet,
  type DefaultDustConfiguration,
  DustWallet,
  type DustWalletClass,
  makeEventLessSyncCapability,
  makeEventLessSyncService,
} from '@midnightntwrk/wallet-sdk-dust-wallet';
import { V1Builder } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';

/** The factory shape {@link provideWallet} and the scenarios accept for the dust sub-wallet. */
export type DustWalletFactory = (config: DefaultDustConfiguration) => DustWalletClass;

/**
 * A dust sub-wallet that syncs from indexer projections instead of the event stream.
 *
 * The sync service is swapped in at build time, so a wallet built without this factory gets the event-based sync no
 * matter what else it configures.
 *
 * The projections sync synchronizes in finite passes rather than over a live subscription, but background
 * synchronization re-runs those passes on an interval, so this factory can be used on its own and the usual state
 * waiters behave as they do for the event-based sync. Pair it with `manualSync` — see
 * {@link manualProjectionsDustSyncOptions} — only when a caller wants to decide when each pass happens.
 */
export const eventLessDustWallet: DustWalletFactory = (config) =>
  CustomDustWallet(
    config,
    new V1Builder().withDefaults().withSync(makeEventLessSyncService, makeEventLessSyncCapability),
  );

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
 * instance. A caller that spreads this in must drive `facade.doSync(dustSecretKey)` itself, after start and again after
 * anything that changes dust state; waiting on `waitForSyncedState()` alone will block, because with `manualSync`
 * nothing advances the dust wallet until `doSync` runs.
 */
export const manualProjectionsDustSyncOptions: {
  readonly dustWallet: DustWalletFactory;
  readonly manualSync: true;
} = {
  dustWallet: eventLessDustWallet,
  manualSync: true,
};
