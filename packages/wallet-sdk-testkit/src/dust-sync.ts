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
import { type DustParameters } from '@midnightntwrk/ledger-v9';
import {
  CustomDustWallet,
  type DefaultDustConfiguration,
  DustWallet,
  type DustWalletAPI,
  makeEventLessSyncCapability,
  makeEventLessSyncService,
} from '@midnightntwrk/wallet-sdk-dust-wallet';
import { V2Builder } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';

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
 * The sync service is swapped in at build time, so a wallet built without this factory gets the event-based sync no
 * matter what else it configures.
 *
 * **This is a one-shot sync and must be driven explicitly.** Where the event-based service's `updates` is a long-lived
 * indexer subscription, the projections service does a single pass up to the block it read at the start and then ends
 * its stream. Background syncing therefore converges once and never observes anything afterwards, and the variant's
 * background retry only re-runs the pass on _failure_, not on completion. Pair this factory with `manualSync: true` —
 * see {@link projectionsDustSyncOptions} — and call `facade.doSync(seeds)` at every point that would otherwise wait for
 * background convergence.
 */
export const eventLessDustWallet: DustWalletFactory = (config) =>
  CustomDustWallet(
    config,
    new V2Builder()
      .withDefaults()
      .withSync(makeEventLessSyncService, makeEventLessSyncCapability)
      // Restated because `withSync` drops it: the seed-to-key derivation a start from a seed needs.
      .withStartAuxDefaults(),
  );

/** The event-stream dust sub-wallet, with the long-lived subscription. This is the default everywhere. */
export const eventBasedDustWallet: DustWalletFactory = DustWallet;

/**
 * The correct way to opt a wallet into the projections-based dust sync: the factory plus `manualSync`, so the caller
 * owns when each snapshot is taken.
 *
 * A caller that spreads this in still has to drive `facade.doSync(seeds)` itself — after start, and again after
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
