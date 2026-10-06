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

// The zswap event subscription must go through the backpressured path. A plain subscription buffers every event the
// indexer pushes, so a wallet catching up on a long chain grows its heap with how far behind it is until it runs out
// of memory. The subscription-tag overrides the other sync tests use cannot tell the two paths apart, so this test
// stands in for the WebSocket client itself.

type Call =
  | { readonly method: 'subscribe' }
  | { readonly method: 'subscribeWithBackpressure'; readonly bufferSize: number; readonly resumeThreshold: number };

// Test-harness bookkeeping: the fake client records what the sync asked it for.
const recorded = vi.hoisted(() => ({ calls: [] as Call[] }));

// The sync service provides its WebSocket layer inline, so the module's layer is the only seam for a fake client.
vi.mock('@midnightntwrk/wallet-sdk-indexer-client/effect', async (importOriginal) => {
  const original = await importOriginal<typeof IndexerClientEffect>();
  const { Layer } = await import('effect');
  const client: IndexerClientEffect.SubscriptionClient.Service = {
    subscribe: () => {
      recorded.calls.push({ method: 'subscribe' });
      return Stream.empty;
    },
    subscribeWithBackpressure: (_document, options) => {
      recorded.calls.push({
        method: 'subscribeWithBackpressure',
        bufferSize: options.bufferSize,
        resumeThreshold: options.resumeThreshold,
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

const subscriptionCalls = async (
  connection: { readonly bufferSize?: number; readonly resumeThreshold?: number } = {},
): Promise<readonly Call[]> => {
  const secretKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
  const state = CoreWallet.initEmpty(secretKeys, NetworkId.NetworkId.Undeployed);
  const syncService = makeEventsSyncService({
    indexerClientConnection: {
      indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
      indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
      ...connection,
    },
    versionWatch: { intervalMs: 0 },
  });

  await syncService.updates(state, secretKeys).pipe(Stream.runDrain, Effect.scoped, Effect.runPromise);

  return [...recorded.calls];
};

describe('V2 shielded wallet event subscription backpressure', () => {
  beforeEach(() => {
    recorded.calls.length = 0;
  });

  it('subscribes through the backpressured path with the default bounds', async () => {
    expect(await subscriptionCalls()).toEqual([
      { method: 'subscribeWithBackpressure', bufferSize: 10000, resumeThreshold: 100 },
    ]);
  });

  it('passes the configured bounds through to the subscription', async () => {
    expect(await subscriptionCalls({ bufferSize: 500, resumeThreshold: 50 })).toEqual([
      { method: 'subscribeWithBackpressure', bufferSize: 500, resumeThreshold: 50 },
    ]);
  });
});
