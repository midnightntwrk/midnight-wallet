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
import { describe, expect, it } from 'vitest';
import {
  DUST_SYNC_ENV_VAR,
  dustSnapshotPath,
  dustSyncModelFromEnv,
  dustSyncModelOf,
  type DustWalletFactory,
  dustWalletFor,
  dustWalletFromEnv,
  eventBasedDustWallet,
  eventLessDustWallet,
  manualProjectionsDustSyncOptions,
  parseDustSyncModel,
  projectionsDustSyncOptions,
} from '../dust-sync.js';

describe('parseDustSyncModel', () => {
  it('defaults to the event-based sync when unset or empty', () => {
    expect(parseDustSyncModel(undefined)).toBe('events');
    expect(parseDustSyncModel('')).toBe('events');
    expect(parseDustSyncModel('   ')).toBe('events');
  });

  it('accepts both model names, tolerating surrounding whitespace', () => {
    expect(parseDustSyncModel('events')).toBe('events');
    expect(parseDustSyncModel('projections')).toBe('projections');
    expect(parseDustSyncModel(' projections ')).toBe('projections');
  });

  it.each(['projection', 'eventless', 'Projections', 'true'])(
    'rejects %s rather than silently falling back to a model the caller did not ask for',
    (raw) => {
      // A silent fallback would report a run as covering one sync model while it actually covered the other.
      expect(() => parseDustSyncModel(raw)).toThrow(DUST_SYNC_ENV_VAR);
    },
  );
});

describe('dustSyncModelFromEnv', () => {
  it('reads the model from the environment', () => {
    expect(dustSyncModelFromEnv({ [DUST_SYNC_ENV_VAR]: 'projections' })).toBe('projections');
    expect(dustSyncModelFromEnv({})).toBe('events');
  });

  it('resolves to the factory implementing the selected model', () => {
    expect(dustWalletFromEnv({ [DUST_SYNC_ENV_VAR]: 'projections' })).toBe(eventLessDustWallet);
    expect(dustWalletFromEnv({})).toBe(eventBasedDustWallet);
  });
});

describe('dustSyncModelOf', () => {
  it('round-trips every model through its factory', () => {
    expect(dustSyncModelOf(dustWalletFor('events'))).toBe('events');
    expect(dustSyncModelOf(dustWalletFor('projections'))).toBe('projections');
  });

  it('reports an unrecognized factory as custom', () => {
    // An unidentified factory must not be filed under either known model: it would then share a snapshot with a sync
    // model it may not implement. `custom` gives it a namespace of its own instead.
    const ownFactory: DustWalletFactory = (config) => eventLessDustWallet(config);
    expect(dustSyncModelOf(ownFactory)).toBe('custom');
  });
});

describe('dustSnapshotPath', () => {
  it('gives each sync model its own dust snapshot', () => {
    const paths = (['events', 'projections', 'custom'] as const).map((model) =>
      dustSnapshotPath('/cache', 'abc1234-testnet.state', model),
    );
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths[0]).toBe('/cache/dust-events-abc1234-testnet.state');
  });
});

describe('the ready-made options', () => {
  it('both select the projections sync, differing only in who drives the passes', () => {
    expect(dustSyncModelOf(projectionsDustSyncOptions.dustWallet)).toBe('projections');
    expect(dustSyncModelOf(manualProjectionsDustSyncOptions.dustWallet)).toBe('projections');
    // The plain options must not carry `manualSync`: spreading them into a test that waits on the state stream would
    // otherwise block forever, since nothing advances the dust wallet until `doSync` runs.
    expect(projectionsDustSyncOptions).not.toHaveProperty('manualSync');
    expect(manualProjectionsDustSyncOptions.manualSync).toBe(true);
  });
});
