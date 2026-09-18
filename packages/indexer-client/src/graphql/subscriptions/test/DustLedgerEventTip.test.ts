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
import { Chunk, Effect, Layer, Ref, Stream } from 'effect';
import { print } from 'graphql';
import { describe, expect, it } from 'vitest';
import { SubscriptionClient } from '../../../effect/index.js';
import type { Query } from '../../../effect/Query.js';
import type {
  DustLedgerEventTipSubscription,
  DustLedgerEventTipSubscriptionVariables,
} from '../../generated/graphql.js';
import { DustLedgerEventTip } from '../DustLedgerEventTip.js';

type RecordedRequest = Readonly<{ document: string; variables: unknown }>;

/** The canned answer this suite's stubs hand back, shaped by the generated subscription type. */
const eventTip: DustLedgerEventTipSubscription = {
  dustLedgerEvents: { id: 41, maxId: 97 },
};

/**
 * The exact operation the wallet must put on the wire.
 *
 * @remarks
 *   Two fields and no more. `maxId` is the answer — how far the dust event timeline goes — and `id` is what makes the
 *   answer checkable against the cursor that asked. `raw` is deliberately absent: the caller never deserializes this
 *   event, and asking for its bytes would pull a payload across the wire on every poll for nothing.
 */
const expectedDocument = `subscription DustLedgerEventTip($id: Int) {
  dustLedgerEvents(id: $id) {
    id
    maxId
  }
}`;

/** A `SubscriptionClient` stub that records every document it is asked to subscribe to. */
const recordingSubscriptionClient = (
  requests: Ref.Ref<readonly RecordedRequest[]>,
): Layer.Layer<SubscriptionClient> => {
  const service: SubscriptionClient.Service = {
    subscribe: <R, V, T extends Query.Document<R, V> = Query.Document<R, V>>(document: T, variables: V) =>
      Stream.unwrap(
        Ref.update(requests, (recorded) => [...recorded, { document: print(document), variables }]).pipe(
          // Type cast required because: `subscribe` is generic over the document type, so `Query.Result<T>` cannot be
          // narrowed from inside the implementation. This stub answers every document with the one canned result.
          Effect.as(Stream.make(eventTip as Query.Result<T>)),
        ),
      ),
    subscribeWithBackpressure: () => Stream.empty,
  };

  return Layer.succeed(SubscriptionClient, service);
};

describe('DustLedgerEventTip subscription', () => {
  it('should execute the dustLedgerEvents operation asking only for the id and the timeline length', async () => {
    const variables: DustLedgerEventTipSubscriptionVariables = { id: 40 };

    const { recorded, result } = await Effect.gen(function* () {
      const requests = yield* Ref.make<readonly RecordedRequest[]>([]);
      const result = yield* DustLedgerEventTip.run(variables).pipe(
        Stream.runCollect,
        Effect.provide(recordingSubscriptionClient(requests)),
      );

      return { recorded: yield* Ref.get(requests), result: Chunk.toArray(result) };
    }).pipe(
      Effect.mapError((err) => `Encountered unexpected error: ${err.message}`),
      Effect.runPromise,
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0].document.trim()).toEqual(expectedDocument);
    expect(recorded[0].variables).toEqual({ id: 40 });
    expect(result).toEqual([eventTip]);
  });

  it('should support subscription function injection', async () => {
    const variables: DustLedgerEventTipSubscriptionVariables = { id: null };
    const seen = Effect.runSync(Ref.make<readonly DustLedgerEventTipSubscriptionVariables[]>([]));
    const requests = Effect.runSync(Ref.make<readonly RecordedRequest[]>([]));
    const injected = (received: DustLedgerEventTipSubscriptionVariables) =>
      Stream.unwrap(Ref.update(seen, (all) => [...all, received]).pipe(Effect.as(Stream.make(eventTip))));

    await Effect.gen(function* () {
      expect(Chunk.toArray(yield* Stream.runCollect(DustLedgerEventTip.run(variables)))).toEqual([eventTip]);
      expect(yield* Ref.get(seen)).toEqual([variables]);
      // The injected function short-circuits the client: nothing reaches the wire.
      expect(yield* Ref.get(requests)).toEqual([]);
    }).pipe(
      Effect.provideService(DustLedgerEventTip.tag, injected),
      Effect.provide(recordingSubscriptionClient(requests)),
      Effect.mapError((err) => `Encountered unexpected error: ${err.message}`),
      Effect.runPromise,
    );
  });
});
