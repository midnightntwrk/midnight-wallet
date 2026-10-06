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
import { DustSecretKey, LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { SubscriptionClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { Effect, Layer, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { makeIndexerSyncService } from '../Sync.js';

// The Dust event subscription must go through the backpressured path. A plain subscription buffers every event the
// indexer pushes, so a wallet catching up on a long chain grows its heap with how far behind it is until it runs out
// of memory. The subscription-tag overrides the other sync tests use cannot tell the two paths apart, so this test
// stands in for the WebSocket client itself.

type Call =
  | { readonly method: 'subscribe' }
  | {
      readonly method: 'subscribeWithBackpressure';
      readonly bufferSize: number;
      readonly resumeThreshold: number;
      // What the sync reads as an event's position. Backpressure resumes from it and drops the event a resume repeats,
      // so a wrong field would lose or duplicate events.
      readonly keyOfEvent7: bigint;
    };

/** Reads the backpressure key of an event whose id is 7, on a timeline whose highest id is 99. */
const keyOfEvent7 = (key: (item: never) => bigint): bigint =>
  // Type cast required because: the fake client is generic over every subscription document, and this test drives
  // only the dustLedgerEvents one. The tip id differs from the event id, so a key reading the wrong field shows.
  (key as (item: { readonly dustLedgerEvents: { readonly id: number; readonly maxId: number } }) => bigint)({
    dustLedgerEvents: { id: 7, maxId: 99 },
  });

const networkId = NetworkId.NetworkId.Undeployed;
const dustParameters = LedgerParameters.initialParameters().dust;
const seedHex = '0000000000000000000000000000000000000000000000000000000000000001';

const subscriptionCalls = async (
  connection: { readonly bufferSize?: number; readonly resumeThreshold?: number } = {},
): Promise<readonly Call[]> => {
  // Test-harness bookkeeping: the fake client records what the sync asked it for.
  const calls: Call[] = [];
  const client: SubscriptionClient.Service = {
    subscribe: () => {
      calls.push({ method: 'subscribe' });
      return Stream.empty;
    },
    subscribeWithBackpressure: (_document, options) => {
      calls.push({
        method: 'subscribeWithBackpressure',
        bufferSize: options.bufferSize,
        resumeThreshold: options.resumeThreshold,
        keyOfEvent7: keyOfEvent7(options.key),
      });
      return Stream.empty;
    },
  };

  const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
  const state = CoreWallet.initEmpty(dustParameters, secretKey, networkId);
  const syncService = makeIndexerSyncService({
    indexerClientConnection: {
      indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
      indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
      ...connection,
    },
    networkId,
  });

  await syncService
    .subscribeWallet(state)
    .pipe(Stream.runDrain, Effect.provide(Layer.succeed(SubscriptionClient, client)), Effect.scoped, Effect.runPromise);

  return calls;
};

describe('V1 dust wallet event subscription backpressure', () => {
  it('subscribes through the backpressured path with the default bounds', async () => {
    expect(await subscriptionCalls()).toEqual([
      { method: 'subscribeWithBackpressure', bufferSize: 10000, resumeThreshold: 100, keyOfEvent7: 7n },
    ]);
  });

  it('passes the configured bounds through to the subscription', async () => {
    expect(await subscriptionCalls({ bufferSize: 500, resumeThreshold: 50 })).toEqual([
      { method: 'subscribeWithBackpressure', bufferSize: 500, resumeThreshold: 50, keyOfEvent7: 7n },
    ]);
  });
});
