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
  InMemoryTransactionHistoryStorage,
  NetworkId as Networks,
  ProtocolVersion,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { dustWalletProbes } from '../DustWallet.js';
import { type DefaultDustConfiguration } from '../DustWalletAPI.js';
import { type DustTimelineStart } from '../types/DustWalletTypes.js';
import { TransactionHistory as V2TransactionHistory } from '../v2/index.js';

// Every composition that starts a forking dust wallet, `DustWallet` and the testkit's projections wallet among them,
// takes its probes from `dustWalletProbes`, so what is pinned here is where all of them begin a fresh start.

const v9 = ProtocolVersion.ProtocolVersion(7n);

const configuration = (overrides: Partial<DefaultDustConfiguration> = {}): DefaultDustConfiguration => ({
  networkId: Networks.NetworkId.Undeployed,
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(V2TransactionHistory.DustTransactionHistoryEntrySchema),
  costParameters: { feeBlocksMargin: 0 },
  forks: { v9 },
  ...overrides,
});

/** A timeline search that records what it was asked and answers with the given start. */
const recordingSearch = (answer: Option.Option<DustTimelineStart>) => {
  const asked: { configuration: unknown; boundary: ProtocolVersion.ProtocolVersion }[] = [];
  const search = (searched: unknown, boundary: ProtocolVersion.ProtocolVersion) => {
    asked.push({ configuration: searched, boundary });
    return Effect.succeed(answer);
  };
  return { asked, search };
};

describe('dustWalletProbes', () => {
  it.each([false, undefined])(
    'should set no timeline search when skipLedgerV8DustHistory is %s, so a fresh start replays the ledger-v8 dust history',
    (skip) => {
      const { asked, search } = recordingSearch(Option.none());

      const probes = dustWalletProbes(
        configuration(skip === undefined ? {} : { skipLedgerV8DustHistory: skip }),
        search,
      );

      expect(probes).not.toHaveProperty('dustTimelineStartProbe');
      expect(asked).toEqual([]);
    },
  );

  it("should search the wallet's own indexer for where the timeline reaches forks.v9, and answer with what the search finds", async () => {
    const start: DustTimelineStart = { cursor: 41n, version: v9 };
    const { asked, search } = recordingSearch(Option.some(start));
    const config = configuration({ skipLedgerV8DustHistory: true });

    const answer = await dustWalletProbes(config, search).dustTimelineStartProbe?.();

    expect(answer).toEqual(Option.some(start));
    expect(asked).toEqual([{ configuration: config, boundary: v9 }]);
  });

  it('should search only when the start asks, never while the wallet is being configured', () => {
    const { asked, search } = recordingSearch(Option.none());

    dustWalletProbes(configuration({ skipLedgerV8DustHistory: true }), search);

    expect(asked).toEqual([]);
  });

  it('should keep a chain version probe the configuration already names, and make one otherwise', () => {
    const given: ChainVersionProbe = () => Promise.resolve(v9);

    expect(dustWalletProbes(configuration({ chainVersionProbe: given })).chainVersionProbe).toBe(given);
    expect(dustWalletProbes(configuration()).chainVersionProbe).toBeTypeOf('function');
  });
});
