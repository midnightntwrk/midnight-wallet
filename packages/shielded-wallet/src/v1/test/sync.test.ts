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

import * as ledger from '@midnight-ntwrk/ledger-v6';
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
  Layer,
} from 'effect';
import { ClientError, ServerError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import {
  HttpQueryClient,
  SubscriptionClient,
  WsSubscriptionClient,
} from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment } from 'testcontainers';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Connect, Disconnect, ShieldedTransactions, ZswapEvents } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import type {
  ZswapEventsSubscription,
  ZswapEventsSubscriptionVariables,
} from '@midnight-ntwrk/wallet-sdk-indexer-client';
import { makeEventsSyncService } from '../Sync.js';
import { CoreWallet } from '../CoreWallet.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Simulator } from '../Simulator.js';

const KNOWN_VIEWING_KEY = 'mn_shield-esk_undeployed1qqpsq87f9ac09e95wjm2rp8vp0yd0z4pns7p2w7c9qus0vm20fj4dl93nu709t';

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;

const environmentId = randomUUID();

const environmentVars = buildTestEnvironmentVariables(['APP_INFRA_SECRET'], {
  additionalVars: {
    TESTCONTAINERS_UID: environmentId,
  },
});

const environment = new DockerComposeEnvironment(getComposeDirectory(), 'docker-compose-dynamic.yml').withEnvironment(
  environmentVars,
);

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
      Stream.range(1, totalRecords + 1),
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
    it('should handle batching events into multiples of 50 events with no delay', async () => {
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
        });

        const { stream, batches } = yield* withBatchLogging(
          syncService.updates(initialState, secretKeys),
          batchSize,
          batchTimeout,
        );

        const updates = yield* stream.pipe(Stream.take(numberOfEventsToProduce), Stream.runCollect);
        const batchSizes = yield* Ref.get(batches);

        const updatesArray = Chunk.toArray(updates);
        expect(updatesArray.length).toBe(numberOfEventsToProduce);

        // Verify size-based batching: should have full batches of batchSize, plus possibly a final partial batch
        const expectedFullBatches = Math.floor(numberOfEventsToProduce / batchSize);
        const hasPartialBatch = numberOfEventsToProduce % batchSize !== 0;
        expect(batchSizes.length).toBeGreaterThanOrEqual(expectedFullBatches);

        // All full batches should be size batchSize (size-based batching)
        for (let i = 0; i < expectedFullBatches; i++) {
          expect(batchSizes[i]).toBe(batchSize);
        }

        // If there's a partial batch, verify it's the last one and is less than 50
        if (hasPartialBatch && batchSizes.length > expectedFullBatches) {
          const lastBatchSize = batchSizes[batchSizes.length - 1];
          expect(lastBatchSize).toBeLessThan(batchSize);
          expect(lastBatchSize).toBeGreaterThan(0);
        }

        // Verify batch totals add up to at least NUM_EVENTS (may be slightly more due to stream buffering)
        const totalFromBatches = batchSizes.reduce((sum, size) => sum + size, 0);
        expect(totalFromBatches).toBeGreaterThanOrEqual(numberOfEventsToProduce);

        yield* Effect.log(`Processed ${updatesArray.length} updates in ${batchSizes.length} size-based batches`);
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

  // TODO: This is replicating the tests from indexer client, it should be rewritten to use the wallet sync service instead
  describe.skip('with available Indexer Server', () => {
    let startedEnvironment: StartedDockerComposeEnvironment | undefined = undefined;
    const getIndexerPort = () =>
      startedEnvironment?.getContainer(`indexer_${environmentId}`).getMappedPort(8088) ?? 8088;

    beforeAll(async () => {
      startedEnvironment = await environment.up();
    }, timeout_minutes(3));

    afterAll(async () => {
      await startedEnvironment?.down();
    }, timeout_minutes(1));

    it(
      'should stream GraphQL subscription',
      async () => {
        const makeScopedSession = Effect.acquireRelease(Connect.run({ viewingKey: KNOWN_VIEWING_KEY }), (session) =>
          Disconnect.run({ sessionId: session.connect }).pipe(Effect.catchAll((_) => Effect.void)),
        );

        await Effect.gen(function* () {
          const session = yield* makeScopedSession;
          const events = yield* ShieldedTransactions.run({
            sessionId: session.connect,
            index: null,
          }).pipe(
            Stream.take(5),
            Stream.tap((data) => Effect.log(data.shieldedTransactions.__typename)),
            Stream.runCollect, // collect the elements into a single chunk.
          );

          expect(events).toHaveLength(5);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              HttpQueryClient.layer({ url: `http://127.0.0.1:${getIndexerPort()}/api/v3/graphql` }),
              WsSubscriptionClient.layer({ url: `ws://127.0.0.1:${getIndexerPort()}/api/v3/graphql/ws` }),
            ),
          ),
          Effect.scoped,
          Effect.runPromise,
        );
      },
      timeout_minutes(1),
    );
  });
});
