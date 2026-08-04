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
 * **This is a one-shot sync and must be driven explicitly.** Where the event-based service's `updates` is a long-lived
 * indexer subscription, the projections service does a single pass up to the block it read at the start and then ends
 * its stream. Background syncing therefore converges once and never observes anything afterwards, and the variant's
 * background retry only re-runs the pass on _failure_, not on completion. Pair this factory with `manualSync: true` —
 * see {@link projectionsDustSyncOptions} — and call `facade.doSync(dustSecretKey)` at every point that would otherwise
 * wait for background convergence.
 */
export const eventLessDustWallet: DustWalletFactory = (config) =>
  CustomDustWallet(
    config,
    new V1Builder().withDefaults().withSync(makeEventLessSyncService, makeEventLessSyncCapability),
  );

/** The event-stream dust sub-wallet, with the long-lived subscription. This is the default everywhere. */
export const eventBasedDustWallet: DustWalletFactory = DustWallet;

/**
 * The correct way to opt a wallet into the projections-based dust sync: the factory plus `manualSync`, so the caller
 * owns when each snapshot is taken.
 *
 * A caller that spreads this in still has to drive `facade.doSync(dustSecretKey)` itself — after start, and again after
 * anything that changes dust state. Waiting on `waitForSyncedState()` alone will block, because with `manualSync`
 * nothing advances the dust wallet until `doSync` runs.
 */
export const projectionsDustSyncOptions: {
  readonly dustWallet: DustWalletFactory;
  readonly manualSync: true;
} = {
  dustWallet: eventLessDustWallet,
  manualSync: true,
};
