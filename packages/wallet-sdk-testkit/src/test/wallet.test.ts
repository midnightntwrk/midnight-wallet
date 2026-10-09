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
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DUST_SYNC_ENV_VAR,
  type DustSnapshotModel,
  dustSyncModelOf,
  dustWalletFromEnv,
  eventBasedDustWallet,
  eventLessDustWallet,
} from '../dust-sync.js';
import { type ProvideWalletOptions, withProjectionsDefault } from '../wallet.js';

/**
 * The model a wallet built from these options would actually run, resolved the way `provideWallet` and
 * `initWalletWithSeed` resolve it. Asserting on the factory alone would miss the half of the defect that lives in that
 * fallback: an option object carrying `dustWallet: undefined` reads as "projections was requested" until the absent
 * factory reaches `?? dustWalletFromEnv()` and becomes the event-based sync.
 */
const modelOf = (options: Pick<ProvideWalletOptions, 'dustWallet' | 'manualSync'>): DustSnapshotModel =>
  dustSyncModelOf(options.dustWallet ?? dustWalletFromEnv());

describe('withProjectionsDefault', () => {
  afterEach(() => vi.unstubAllEnvs());

  /** `DUST_SYNC` is read from the ambient environment, so a run with it set must not decide these. */
  const withoutDustSync = () => vi.stubEnv(DUST_SYNC_ENV_VAR, undefined);

  it('fills the projections default in when the caller names other options but not the factory', () => {
    withoutDustSync();
    // A whole-parameter default would be lost here, leaving the scenario on the model it exists to stop monitoring.
    expect(modelOf(withProjectionsDefault({ manualSync: false }))).toBe('projections');
  });

  it('fills the projections default in when the caller passes the factory as undefined', () => {
    withoutDustSync();
    // `dustWallet` is declared `| undefined` so an optional factory can be forwarded under
    // `exactOptionalPropertyTypes`; forwarding an absent one is not a choice of the other model.
    expect(modelOf(withProjectionsDefault({ manualSync: false, dustWallet: undefined }))).toBe('projections');
  });

  it('fills the projections default in when the caller passes no options at all', () => {
    withoutDustSync();
    expect(modelOf(withProjectionsDefault(undefined))).toBe('projections');
  });

  it('leaves a pinned factory alone', () => {
    withoutDustSync();
    expect(withProjectionsDefault({ dustWallet: eventBasedDustWallet }).dustWallet).toBe(eventBasedDustWallet);
    expect(withProjectionsDefault({ dustWallet: eventLessDustWallet }).dustWallet).toBe(eventLessDustWallet);
  });

  it.each([
    ['no factory named', { manualSync: false }],
    ['the factory named as undefined', { manualSync: false, dustWallet: undefined }],
    ['no options at all', undefined],
  ])('lets DUST_SYNC=events override the fallback with %s', (_case, walletOptions) => {
    // The fallback is a fallback, not a pin: a lane switched by environment must switch whole, or it reports coverage
    // the run did not have.
    vi.stubEnv(DUST_SYNC_ENV_VAR, 'events');
    expect(modelOf(withProjectionsDefault(walletOptions))).toBe('events');
  });

  it('passes the caller’s other options through untouched', () => {
    withoutDustSync();
    expect(withProjectionsDefault({ manualSync: true }).manualSync).toBe(true);
  });
});
