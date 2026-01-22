// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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

import { vi } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import {
  Effect,
  Stream,
  Scope,
  pipe,
  Chunk,
  Option,
  Duration,
  TestClock,
  TestContext,
  Fiber,
  Ref,
  Number as Num,
} from 'effect';
import { type ClientError, type ServerError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { type SubscriptionClient } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { describe, expect, it } from 'vitest';
import { ZswapEvents } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import type {
  ZswapEventsSubscription,
  ZswapEventsSubscriptionVariables,
} from '@midnight-ntwrk/wallet-sdk-indexer-client';
import { makeEventsSyncService } from '../Sync.js';
import { CoreWallet } from '../CoreWallet.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Simulator } from '../Simulator.js';

vi.setConfig({
  testTimeout: 10_000,
});

// Helper to create a valid hex-encoded ledger event
const createMockEventHex = async (): Promise<string> => {
  // Use Simulator to generate a real event, then serialize it
  return await Effect.gen(function* () {
    const scope = yield* Scope.make();
    const simulator = yield* Simulator.init([
      {
        amount: 1000n,
        type: ledger.shieldedToken().raw,
        recipient: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)),
      },
    ]).pipe(Effect.provideService(Scope.Scope, scope));

    const stateOption = yield* simulator.state$.pipe(Stream.take(1), Stream.runHead);
    const state = Option.match(stateOption, {
      onNone: () => {
        throw new Error('No state from simulator');
      },
      onSome: (s) => s,
    });

    const events = state.lastTxResult.events;
    if (events.length === 0) {
      throw new Error('No events generated from simulator');
    }

    const event = events[0];
    if (!event) {
      throw new Error('No event at index 0');
    }

    const serialized = event.serialize();
    return Buffer.from(serialized).toString('hex');
  }).pipe(Effect.scoped, Effect.runPromise);
};

type TimingOptions = {
  delayEvents?: boolean;
  minDelay?: Duration.Duration;
  maxDelay?: Duration.Duration;
  useTestClock?: boolean;
};

const createMockSubscriptionFn = (
  totalRecords: number,
  mockEventHex: string,
  timingOptions?: TimingOptions,
): ((
  _variables: ZswapEventsSubscriptionVariables,
) => Stream.Stream<ZswapEventsSubscription, ClientError | ServerError, SubscriptionClient>) => {
  const { delayEvents = false, minDelay, maxDelay, useTestClock = false } = timingOptions ?? {};

  return (_variables: ZswapEventsSubscriptionVariables) => {
    const baseStream = pipe(
      Stream.range(1, totalRecords),
      Stream.map((id) => ({
        zswapLedgerEvents: {
          id,
          raw: mockEventHex,
          maxId: totalRecords,
        },
      })),
    );

    if (delayEvents) {
      if (minDelay === undefined || maxDelay === undefined) {
        throw new Error('minDelay and maxDelay are required when delayEvents is true');
      }

      const minDelayMillis = Duration.toMillis(minDelay);
      const maxDelayMillis = Duration.toMillis(maxDelay);

      return pipe(
        baseStream,
        Stream.tap(() => {
          // Generate a random delay between minDelay and maxDelay
          const randomDelayMillis = Math.floor(Math.random() * (maxDelayMillis - minDelayMillis + 1)) + minDelayMillis;

          const delay = Duration.millis(randomDelayMillis);

          // Use TestClock.sleep when in test clock context, otherwise use Effect.sleep
          return useTestClock ? TestClock.sleep(delay) : Effect.sleep(delay);
        }),
      ) as Stream.Stream<ZswapEventsSubscription, ClientError | ServerError, SubscriptionClient>;
    }

    return baseStream as Stream.Stream<ZswapEventsSubscription, ClientError | ServerError, SubscriptionClient>;
  };
};

// Helper to capture batch information at the consumer and log it
const withBatchLogging = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  batchSize: number,
  batchTimeout: Duration.Duration,
): Effect.Effect<{ stream: Stream.Stream<A, E, R>; batches: Ref.Ref<readonly number[]> }, never, R> => {
  return Effect.gen(function* () {
    const batchesRef = yield* Ref.make<readonly number[]>([]);

    // Re-group the stream to detect batches (using same params as Sync.ts)
    // This will create batches that match the original batching behavior
    const groupedStream = stream.pipe(
      Stream.groupedWithin(batchSize, batchTimeout),
      Stream.tap((chunk) => {
        const chunkSize = Chunk.size(chunk);
        const isSizeBased = chunkSize === batchSize;
        return pipe(
          Ref.update(batchesRef, (batches) => [...batches, chunkSize]),
          Effect.flatMap(() =>
            Effect.log(`Batch released: ${chunkSize} records (${isSizeBased ? 'size-based' : 'timeout-based'})`),
          ),
        );
      }),
      Stream.flatMap((chunk) => Stream.fromIterable(chunk)),
    );

    return { stream: groupedStream, batches: batchesRef };
  });
};

describe('Wallet subscription', () => {
  const batchSize = 50;
  const batchTimeout = Duration.seconds(10);

  // number of events should not be divisible by batchSize so we can test
  // the case where we have a partial batch
  const numberOfEventsToProduce = 333;

  describe('should stream GraphQL subscription', () => {
    it('should handle batching events into multiples of batch size config with no delay', async () => {
      const mockEventHex = await createMockEventHex();
      const mockSubscriptionFn = createMockSubscriptionFn(numberOfEventsToProduce, mockEventHex);

      const secretKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
      const initialState = CoreWallet.initEmpty(secretKeys, NetworkId.NetworkId.Undeployed);

      await Effect.gen(function* () {
        const syncService = makeEventsSyncService({
          indexerClientConnection: {
            indexerHttpUrl: 'http://localhost:8088/api/v3/graphql',
            indexerWsUrl: 'ws://localhost:8088/api/v3/graphql/ws',
          },
          batchSize,
        });

        const updates = yield* syncService.updates(initialState, secretKeys).pipe(Stream.runCollect);
        const batchSizes = pipe(
          updates,
          Chunk.map((update) => update.updates.length),
        );

        // Verify size-based batching: should have full batches of batchSize, plus possibly a final partial batch
        const expectedFullBatches = Math.floor(numberOfEventsToProduce / batchSize);
        const lastBatchSize = numberOfEventsToProduce % batchSize;
        const expectedBatchSizes = Chunk.makeBy(expectedFullBatches, () => batchSize).pipe(Chunk.append(lastBatchSize));

        expect(Num.sumAll(batchSizes)).toEqual(numberOfEventsToProduce);
        expect(Chunk.size(updates)).toBe(Math.ceil(numberOfEventsToProduce / batchSize));
        expect(batchSizes).toEqual(expectedBatchSizes);
      }).pipe(Effect.provideService(ZswapEvents.tag, mockSubscriptionFn), Effect.scoped, Effect.runPromise);
    });

    it('should handle batching events by introducing a random delay', async () => {
      const minDelay = Duration.millis(500);
      const maxDelay = Duration.millis(1500);

      const mockEventHex = await createMockEventHex();
      const mockSubscriptionFn = createMockSubscriptionFn(numberOfEventsToProduce, mockEventHex, {
        delayEvents: true,
        minDelay,
        maxDelay,
        useTestClock: true,
      });

      const secretKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
      const initialState = CoreWallet.initEmpty(secretKeys, NetworkId.NetworkId.Undeployed);

      // Use TestClock to speed up the test - fork the stream, advance time, then join
      await Effect.gen(function* () {
        const syncService = makeEventsSyncService({
          indexerClientConnection: {
            indexerHttpUrl: 'http://localhost:8088/api/v3/graphql',
            indexerWsUrl: 'ws://localhost:8088/api/v3/graphql/ws',
          },
        });

        const { stream, batches } = yield* withBatchLogging(
          syncService.updates(initialState, secretKeys),
          batchSize,
          batchTimeout,
        );

        // Fork the stream to allow us to advance the test clock
        const streamFiber = yield* Effect.fork(stream.pipe(Stream.take(numberOfEventsToProduce), Stream.runCollect));

        // Calculate the total time needed, worst case scenario.
        const timePerEvent = Duration.millis(Duration.toMillis(maxDelay) + Duration.toMillis(batchTimeout));
        const totalTimeNeeded = Duration.millis(Duration.toMillis(timePerEvent) * numberOfEventsToProduce);

        yield* TestClock.adjust(totalTimeNeeded);

        // Get the results
        const updates = yield* Fiber.join(streamFiber);
        const batchSizes = yield* Ref.get(batches);

        const updatesArray = Chunk.toArray(updates);
        expect(updatesArray.length).toBe(numberOfEventsToProduce);

        // Verify we got timeout-based batches (not all size 50)
        const timeoutBasedBatches = batchSizes.filter((size) => size < 50);
        expect(timeoutBasedBatches.length).toBeGreaterThan(0);

        const totalFromBatches = batchSizes.reduce((sum, size) => sum + size, 0);
        expect(totalFromBatches).toBeGreaterThanOrEqual(numberOfEventsToProduce);

        // Verify we have multiple batches (batching is working)
        expect(batchSizes.length).toBeGreaterThan(1);

        yield* Effect.log(
          `Processed ${updatesArray.length} updates in ${batchSizes.length} batches (${timeoutBasedBatches.length} timeout-based)`,
        );
      }).pipe(
        Effect.provideService(ZswapEvents.tag, mockSubscriptionFn),
        Effect.provide(TestContext.TestContext),
        Effect.scoped,
        Effect.runPromise,
      );
    });
  });
});
