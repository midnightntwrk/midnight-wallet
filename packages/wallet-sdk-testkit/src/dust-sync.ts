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
 * The projections sync synchronizes in finite passes rather than over a live subscription, but background
 * synchronization re-runs those passes on an interval, so this factory can be used on its own and the usual state
 * waiters behave as they do for the event-based sync. Pair it with `manualSync` — see {@link projectionsDustSyncOptions}
 * — only when a caller wants to decide when each pass happens.
 *
 * **A wallet built this way syncs, but must not transact.** `CustomDustWallet` is a single-variant composition, whose
 * one variant answers for the whole protocol timeline: it reports the minimum supported version and stamps whatever it
 * builds at that version. A facade acts at the lowest version its three sub-wallets report, so this sub-wallet holds
 * the facade below the ledger-v9 boundary, and the facade then refuses the shielded wallet's ledger-v9 transaction
 * because the two sides of a boundary cannot be merged. Build transactions on a wallet using the shipped two-variant
 * dust wallet, and use one built here to observe the result.
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
 * The projections dust sync with background synchronization switched off, so the caller decides when each pass runs.
 *
 * Use this when a test needs passes to happen at known points — asserting on the state a specific pass produced, for
 * instance. A caller that spreads this in must drive `facade.doSync(seeds)` itself, after start and again after
 * anything that changes dust state; waiting on `waitForSyncedState()` alone will block, because with `manualSync`
 * nothing advances the dust wallet until `doSync` runs.
 *
 * For a test that just wants the wallet to keep up on its own, pass `{ dustWallet: eventLessDustWallet }` instead and
 * let background synchronization run the passes. Either way the wallet syncs but must not transact — see
 * {@link eventLessDustWallet}.
 */
export const projectionsDustSyncOptions: {
  readonly dustWallet: DustWalletFactory;
  readonly manualSync: true;
} = {
  dustWallet: eventLessDustWallet,
  manualSync: true,
};
