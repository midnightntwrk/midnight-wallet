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
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  type DefaultDustConfiguration,
  type DustGenerationRates,
  type ForkingDustConfiguration,
} from '@midnightntwrk/wallet-sdk-dust-wallet';
import { TransactionHistory } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';
import { type CanAssign, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { describe, expect, it } from 'vitest';
import {
  DUST_SYNC_ENV_VAR,
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

  it('applies the caller-chosen fallback only when the environment is silent', () => {
    expect(dustSyncModelFromEnv({}, 'projections')).toBe('projections');
    expect(dustSyncModelFromEnv({ [DUST_SYNC_ENV_VAR]: '' }, 'projections')).toBe('projections');
  });

  it.each([
    ['events', eventBasedDustWallet],
    ['projections', eventLessDustWallet],
  ])('lets DUST_SYNC=%s override the fallback', (configured, expected) => {
    // A fallback that could not be overridden would silently split a lane: tests carrying it would keep one model while
    // the rest of the run switched, so `DUST_SYNC` would report coverage the run did not have.
    expect(dustWalletFromEnv({ [DUST_SYNC_ENV_VAR]: configured }, 'projections')).toBe(expected);
    expect(dustWalletFromEnv({ [DUST_SYNC_ENV_VAR]: configured }, 'events')).toBe(expected);
  });

  it('still rejects an unrecognized value rather than using the fallback', () => {
    expect(() => dustSyncModelFromEnv({ [DUST_SYNC_ENV_VAR]: 'projection' }, 'projections')).toThrow(DUST_SYNC_ENV_VAR);
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

describe('DustWalletFactory', () => {
  it('starts a wallet against plain dust rates, so passing custom ones imports no ledger', () => {
    type StartRates = Parameters<ReturnType<DustWalletFactory>['startWithSeed']>[1];
    type _1 = Expect<CanAssign<DustGenerationRates, StartRates>>;
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

describe('skipLedgerV8DustHistory', () => {
  const configuration = (skipLedgerV8DustHistory: boolean | undefined): DefaultDustConfiguration => ({
    networkId: NetworkId.NetworkId.Undeployed,
    indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(TransactionHistory.DustTransactionHistoryEntrySchema),
    costParameters: { feeBlocksMargin: 0 },
    forks: { v9: ProtocolVersion.ProtocolVersion(7n) },
    ...(skipLedgerV8DustHistory === undefined ? {} : { skipLedgerV8DustHistory }),
  });

  /** Whether a wallet built by the factory looks for where the dust timeline reaches the boundary before it starts. */
  const searchesForTimelineStart = (factory: DustWalletFactory, skip: boolean | undefined): boolean =>
    // Type cast required because: `DustWalletFactory` types only the start a facade calls, while the wallet class it
    // returns also carries the configuration it was built with — the one place the timeline search is visible
    // without an indexer to run it against.
    (factory(configuration(skip)) as unknown as { configuration: ForkingDustConfiguration }).configuration
      .dustTimelineStartProbe !== undefined;

  it('should make the projections wallet search for the boundary when set, so a fresh start never replays the ledger-v8 dust history', () => {
    // Without the search, the V1 variant replays every ledger-v8 dust event before the projections sync is reached —
    // on a long-lived network that crossed the v9 fork, the whole of a cold sync.
    expect(searchesForTimelineStart(eventLessDustWallet, true)).toBe(true);
  });

  it.each([true, false, undefined])(
    'should search exactly when the event-based wallet does (skipLedgerV8DustHistory=%s), so the two models start from the same place',
    (skip) => {
      expect(searchesForTimelineStart(eventLessDustWallet, skip)).toBe(
        searchesForTimelineStart(eventBasedDustWallet, skip),
      );
    },
  );
});
