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
import { DustSecretKey, LedgerParameters } from '@midnightntwrk/ledger-v8';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { SubscriptionClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { Effect, Layer, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { makeIndexerSyncService } from '../Sync.js';

// An indexer that stops writing to the Dust event subscription while its socket stays open raises nothing, so a wallet
// that is behind waits on it for as long as the connection lasts. The subscription can give up on such a session, but
// only the wallet can tell it the two things that takes: where an event says the timeline ends, and how far the wallet
// already knows it to go. This test stands in for the WebSocket client to see what the wallet tells it.

type StallRequest = {
  /** Whether the sync asked for a silent session to be given up on at all. */
  readonly asked: boolean;
  /** What the sync reads as the end of the timeline, off an event whose id is 7 on a timeline whose highest id is 99. */
  readonly tipOfEvent7: bigint | undefined;
  readonly knownTip: bigint | undefined;
};

const tipOfEvent7 = (tip: ((item: never) => bigint) | undefined): bigint | undefined =>
  // Type cast required because: the fake client is generic over every subscription document, and this test drives
  // only the dustLedgerEvents one. The tip id differs from the event id, so a tip reading the wrong field shows.
  (
    tip as
      ((item: { readonly dustLedgerEvents: { readonly id: number; readonly maxId: number } }) => bigint) | undefined
  )?.({ dustLedgerEvents: { id: 7, maxId: 99 } });

const networkId = NetworkId.NetworkId.Undeployed;
const dustParameters = LedgerParameters.initialParameters().dust;
const seedHex = '0000000000000000000000000000000000000000000000000000000000000001';

const newWallet = (): CoreWallet =>
  CoreWallet.initEmpty(dustParameters, DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex')), networkId);

const stallRequests = async (state: CoreWallet): Promise<readonly StallRequest[]> => {
  // Test-harness bookkeeping: the fake client records what the sync asked it for.
  const requests: StallRequest[] = [];
  const client: SubscriptionClient.Service = {
    subscribe: () => Stream.empty,
    subscribeWithBackpressure: (_document, options) => {
      requests.push({
        asked: options.stall !== undefined,
        tipOfEvent7: tipOfEvent7(options.stall?.tip),
        knownTip: options.stall?.knownTip,
      });
      return Stream.empty;
    },
  };

  const syncService = makeIndexerSyncService({
    indexerClientConnection: {
      indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
      indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
    },
    networkId,
  });

  await syncService
    .subscribeWallet(state)
    .pipe(Stream.runDrain, Effect.provide(Layer.succeed(SubscriptionClient, client)), Effect.scoped, Effect.runPromise);

  return requests;
};

describe('V1 dust wallet event subscription stall detection', () => {
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

  it('should name no known tip while it has seen no event, because its zero would count as an event owed to it and a chain with no Dust events would never let it rest', async () => {
    const requests = await stallRequests(newWallet());

    expect(requests).toEqual([{ asked: true, tipOfEvent7: 99n, knownTip: undefined }]);
  });
});
