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
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import type * as IndexerClientEffect from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { Effect, Stream } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { makeEventsSyncService } from '../Sync.js';

// An indexer that stops writing to the zswap event subscription while its socket stays open raises nothing, so a
// wallet that is behind waits on it for as long as the connection lasts. The subscription can give up on such a
// session, but only the wallet can tell it the two things that takes: where an event says the timeline ends, and how
// far the wallet already knows it to go. This test stands in for the WebSocket client to see what the wallet tells it.

type StallRequest = {
  /** Whether the sync asked for a silent session to be given up on at all. */
  readonly asked: boolean;
  /** What the sync reads as the end of the timeline, off an event whose id is 7 on a timeline whose highest id is 99. */
  readonly tipOfEvent7: bigint | undefined;
  readonly knownTip: bigint | undefined;
};

const tipOfEvent7 = (tip: ((item: never) => bigint) | undefined): bigint | undefined =>
  // Type cast required because: the fake client is generic over every subscription document, and this test drives
  // only the zswapLedgerEvents one. The tip id differs from the event id, so a tip reading the wrong field shows.
  (
    tip as
      ((item: { readonly zswapLedgerEvents: { readonly id: number; readonly maxId: number } }) => bigint) | undefined
  )?.({ zswapLedgerEvents: { id: 7, maxId: 99 } });

// Test-harness bookkeeping: the fake client records what the sync asked it for.
const recorded = vi.hoisted(() => {
  const requests: StallRequest[] = [];
  return { requests };
});

// The sync service provides its WebSocket layer inline, so the module's layer is the only seam for a fake client.
vi.mock('@midnightntwrk/wallet-sdk-indexer-client/effect', async (importOriginal) => {
  const original = await importOriginal<typeof IndexerClientEffect>();
  const { Layer } = await import('effect');
  const client: IndexerClientEffect.SubscriptionClient.Service = {
    subscribe: () => Stream.empty,
    subscribeWithBackpressure: (_document, options) => {
      recorded.requests.push({
        asked: options.stall !== undefined,
        tipOfEvent7: tipOfEvent7(options.stall?.tip),
        knownTip: options.stall?.knownTip,
      });
      return Stream.empty;
    },
  };
  return {
    ...original,
    WsSubscriptionClient: {
      ...original.WsSubscriptionClient,
      layer: () => Layer.succeed(original.SubscriptionClient, client),
    },
  };
});

const secretKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

const newWallet = (): CoreWallet => CoreWallet.initEmpty(secretKeys, NetworkId.NetworkId.Undeployed);

const stallRequests = async (state: CoreWallet): Promise<readonly StallRequest[]> => {
  const syncService = makeEventsSyncService({
    indexerClientConnection: {
      indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
      indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
    },
    versionWatch: { intervalMs: 0 },
  });

  await syncService.updates(state, secretKeys).pipe(Stream.runDrain, Effect.scoped, Effect.runPromise);

  return [...recorded.requests];
};

describe('V2 shielded wallet event subscription stall detection', () => {
  beforeEach(() => {
    recorded.requests.length = 0;
  });

  it("should ask for a session that is behind and silent to be given up on, reading where the timeline ends from an event's highest id", async () => {
    const requests = await stallRequests(newWallet());

    expect(requests.map((request) => request.tipOfEvent7)).toEqual([99n]);
  });

  it('should say how far it already knows the timeline to go once it has seen an event, so that a session silent from its first event is given up on too', async () => {
    const synced = CoreWallet.updateProgress(newWallet(), { appliedIndex: 5n, highestRelevantWalletIndex: 9n });

    const requests = await stallRequests(synced);

    expect(requests.map((request) => request.knownTip)).toEqual([9n]);
  });

  it('should name its cursor as the known tip when it remembers no higher one, because a snapshot restores the event last applied and nothing of how far the timeline went, and that event exists', async () => {
    // What a restore leaves: the cursor the snapshot saved, and no highest id.
    const restored = CoreWallet.updateProgress(newWallet(), { appliedIndex: 5n });

    const requests = await stallRequests(restored);

    expect(requests.map((request) => request.knownTip)).toEqual([5n]);
  });

  it('should name no known tip while it has seen no event, because its zero would count as an event owed to it and a chain with no zswap events would never let it rest', async () => {
    const requests = await stallRequests(newWallet());

    expect(requests).toEqual([{ asked: true, tipOfEvent7: 99n, knownTip: undefined }]);
  });
});
