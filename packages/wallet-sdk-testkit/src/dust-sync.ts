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
 * waiters behave as they do for the event-based sync. Pair it with `manualSync` — see {@link projectionsDustSyncOptions}
 * — only when a caller wants to decide when each pass happens.
 */
export const eventLessDustWallet: DustWalletFactory = (config) =>
  CustomDustWallet(
    config,
    new V1Builder().withDefaults().withSync(makeEventLessSyncService, makeEventLessSyncCapability),
  );

/** The event-stream dust sub-wallet, with the long-lived subscription. This is the default everywhere. */
export const eventBasedDustWallet: DustWalletFactory = DustWallet;

/**
 * The projections dust sync with background synchronization switched off, so the caller decides when each pass runs.
 *
 * Use this when a test needs passes to happen at known points — asserting on the state a specific pass produced, for
 * instance. A caller that spreads this in must drive `facade.doSync(dustSecretKey)` itself, after start and again after
 * anything that changes dust state; waiting on `waitForSyncedState()` alone will block, because with `manualSync`
 * nothing advances the dust wallet until `doSync` runs.
 *
 * For a test that just wants the wallet to keep up on its own, pass `{ dustWallet: eventLessDustWallet }` instead and
 * let background synchronization run the passes.
 */
export const projectionsDustSyncOptions: {
  readonly dustWallet: DustWalletFactory;
  readonly manualSync: true;
} = {
  dustWallet: eventLessDustWallet,
  manualSync: true,
};
