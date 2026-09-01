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
  UnshieldedTransactionTipSubscription,
  UnshieldedTransactionTipSubscriptionVariables,
} from '../../generated/graphql.js';
import { UnshieldedTransactionTip } from '../UnshieldedTransactionTip.js';

type RecordedRequest = Readonly<{ document: string; variables: unknown }>;

/** The canned answer this suite's stubs hand back, shaped by the generated subscription type. */
const transactionTip: UnshieldedTransactionTipSubscription = {
  unshieldedTransactions: { type: 'UnshieldedTransactionsProgress', highestTransactionId: 97 },
};

/**
 * The exact operation the wallet must put on the wire.
 *
 * @remarks
 *   The progress arm's `highestTransactionId` is the answer. The transaction arm carries nothing but its type: a caller
 *   opens this one past its own cursor, so a transaction frame arriving at all already says there is unapplied history,
 *   and pulling its UTXOs, block and fees across the wire on every poll would buy nothing.
 */
const expectedDocument = `subscription UnshieldedTransactionTip($address: UnshieldedAddress!, $transactionId: Int) {
  unshieldedTransactions(address: $address, transactionId: $transactionId) {
    ... on UnshieldedTransaction {
      type: __typename
    }
    ... on UnshieldedTransactionsProgress {
      type: __typename
      highestTransactionId
    }
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
          Effect.as(Stream.make(transactionTip as Query.Result<T>)),
        ),
      ),
    subscribeWithBackpressure: () => Stream.empty,
  };

  return Layer.succeed(SubscriptionClient, service);
};

describe('UnshieldedTransactionTip subscription', () => {
  it('should execute the unshieldedTransactions operation asking only how far the address timeline goes', async () => {
    const variables: UnshieldedTransactionTipSubscriptionVariables = {
      address: 'mn_addr_undeployed1abc',
      transactionId: 42,
    };

    const { recorded, result } = await Effect.gen(function* () {
      const requests = yield* Ref.make<readonly RecordedRequest[]>([]);
      const result = yield* UnshieldedTransactionTip.run(variables).pipe(
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
    expect(recorded[0].variables).toEqual({ address: 'mn_addr_undeployed1abc', transactionId: 42 });
    expect(result).toEqual([transactionTip]);
  });

  it('should support subscription function injection', async () => {
    const variables: UnshieldedTransactionTipSubscriptionVariables = {
      address: 'mn_addr_undeployed1abc',
      transactionId: null,
    };
    const seen = Effect.runSync(Ref.make<readonly UnshieldedTransactionTipSubscriptionVariables[]>([]));
    const requests = Effect.runSync(Ref.make<readonly RecordedRequest[]>([]));
    const injected = (received: UnshieldedTransactionTipSubscriptionVariables) =>
      Stream.unwrap(Ref.update(seen, (all) => [...all, received]).pipe(Effect.as(Stream.make(transactionTip))));

    await Effect.gen(function* () {
      expect(Chunk.toArray(yield* Stream.runCollect(UnshieldedTransactionTip.run(variables)))).toEqual([
        transactionTip,
      ]);
      expect(yield* Ref.get(seen)).toEqual([variables]);
      // The injected function short-circuits the client: nothing reaches the wire.
      expect(yield* Ref.get(requests)).toEqual([]);
    }).pipe(
      Effect.provideService(UnshieldedTransactionTip.tag, injected),
      Effect.provide(recordingSubscriptionClient(requests)),
      Effect.mapError((err) => `Encountered unexpected error: ${err.message}`),
      Effect.runPromise,
    );
  });
});
