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

import { vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v8';
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
import { type ClientError, type ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { type SubscriptionClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { beforeAll, describe, expect, it } from 'vitest';
import { ZswapEvents } from '@midnightntwrk/wallet-sdk-indexer-client';
import type {
  ZswapEventsSubscription,
  ZswapEventsSubscriptionVariables,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import {
  type EventsSyncUpdate,
  type WalletSyncUpdate,
  makeEventsSyncCapability,
  makeEventsSyncService,
} from '../Sync.js';
import { CoreWallet } from '../CoreWallet.js';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { V8 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';

vi.setConfig({
  testTimeout: 60_000,
});

// Helper to create a valid hex-encoded ledger event
const createMockEventHex = async (amount: bigint): Promise<string> => {
  // Use Simulator to generate a real event, then serialize it
  return await Effect.gen(function* () {
    const scope = yield* Scope.make();
    const simulator = yield* V8.Simulator.init({
      genesisMints: [
        {
          type: 'shielded',
          tokenType: ledger.shieldedToken().raw,
          amount,
          recipient: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)),
        },
      ],
    }).pipe(Effect.provideService(Scope.Scope, scope));

    const stateOption = yield* simulator.state$.pipe(Stream.take(1), Stream.runHead);
    const state = Option.match(stateOption, {
      onNone: () => {
        throw new Error('No state from simulator');
      },
      onSome: (s) => s,
    });

    const lastBlock = V8.getLastBlock(state);
    if (lastBlock === undefined) {
      throw new Error('No block from simulator');
    }
    const events = V8.getLastBlockEvents(state);
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

/**
 * Two real events from two different transactions.
 *
 * @remarks
 *   The sync never cuts a transaction across batches, so a timeline that repeated one event would be a single transaction
 *   of every event. Served alternately, these make each event a transaction of its own, which is what the suites
 *   counting events per batch assume.
 */
const createMockEventHexes = async (): Promise<readonly [string, string]> => [
  await createMockEventHex(1000n),
  await createMockEventHex(2000n),
];

type TimingOptions = {
  delayEvents?: boolean;
  minDelay?: Duration.Duration;
  maxDelay?: Duration.Duration;
  useTestClock?: boolean;
};

const createMockSubscriptionFn = (
  totalRecords: number,
  mockEventHexes: readonly [string, string],
  timingOptions?: TimingOptions,
  /**
   * The protocol version the indexer reports for each event id. Defaults to a constant 1. Per-item versions are what
   * the boundary split in `applyUpdate` keys off, so they have to survive batching intact.
   */
  protocolVersionOf: (id: number) => number = () => 1,
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
          raw: mockEventHexes[id % 2],
          protocolVersion: protocolVersionOf(id),
          // Events served at once are a backlog the source already holds in full; events that trickle in are a live
          // chain, where each new event is the newest the source holds.
          maxId: delayEvents ? id : totalRecords,
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
      );
    }

    return baseStream;
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

/**
 * The events a batch carries.
 *
 * @remarks
 *   The stream's element type also admits the periodic version signal, which every suite here turns off — so every
 *   element they see is an event batch.
 */
const eventsOf = (update: WalletSyncUpdate): readonly EventsSyncUpdate[] =>
  update._tag === 'Events' ? update.updates : [];

/**
 * The version watcher, off.
 *
 * @remarks
 *   These suites are about how the event timeline is batched. The periodic tip-version check is a second source merged
 *   into the same stream, and leaving it on would let a poll add elements to the batches being counted — and, wherever
 *   the test clock is wound past an interval, put a real query on the wire from a unit test.
 */
const noVersionWatch = { intervalMs: 0 } as const;

describe('Wallet subscription', () => {
  const batchSize = 50;
  const batchTimeout = Duration.seconds(10);

  // number of events should not be divisible by batchSize so we can test
  // the case where we have a partial batch
  const numberOfEventsToProduce = 333;

  describe('should stream GraphQL subscription', () => {
    it('should handle batching events into multiples of batch size config with no delay', async () => {
      const mockEventHexes = await createMockEventHexes();
      const mockSubscriptionFn = createMockSubscriptionFn(numberOfEventsToProduce, mockEventHexes);

      const secretKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
      const initialState = CoreWallet.initEmpty(secretKeys, NetworkId.NetworkId.Undeployed);

      await Effect.gen(function* () {
        const syncService = makeEventsSyncService({
          indexerClientConnection: {
            indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
            indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
          },
          versionWatch: noVersionWatch,
          batchUpdates: { size: batchSize },
        });

        const updates = yield* syncService.updates(initialState, secretKeys).pipe(Stream.runCollect);
        const batchSizes = pipe(
          updates,
          Chunk.map((update) => eventsOf(update).length),
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

    it('should respect custom batchUpdates.timeout configuration', async () => {
      const mockEventHexes = await createMockEventHexes();
      const eventCount = 20;

      // Events arrive one-by-one with a 5ms delay between each
      const mockSubscriptionFn = createMockSubscriptionFn(eventCount, mockEventHexes, {
        delayEvents: true,
        minDelay: Duration.millis(5),
        maxDelay: Duration.millis(5),
        useTestClock: true,
      });

      const secretKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
      const initialState = CoreWallet.initEmpty(secretKeys, NetworkId.NetworkId.Undeployed);

      // With a large timeout (10s) and large batch size (100), all 20 events
      // should accumulate into a single batch since neither the size nor
      // the timeout threshold is reached before the stream ends.
      await Effect.gen(function* () {
        const syncService = makeEventsSyncService({
          indexerClientConnection: {
            indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
            indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
          },
          versionWatch: noVersionWatch,
          batchUpdates: { size: 100, timeout: 10_000 },
        });

        const streamFiber = yield* Effect.fork(syncService.updates(initialState, secretKeys).pipe(Stream.runCollect));

        // Advance clock enough for all events to arrive (20 * 5ms = 100ms)
        // plus spacing and timeout
        yield* TestClock.adjust(Duration.seconds(30));

        const updates = yield* Fiber.join(streamFiber);

        // All events should land in a single batch because the timeout (10s)
        // is much larger than the total event delivery time
        expect(Chunk.size(updates)).toBe(1);
        expect(eventsOf(updates.pipe(Chunk.unsafeHead)).length).toBe(eventCount);
      }).pipe(
        Effect.provideService(ZswapEvents.tag, mockSubscriptionFn),
        Effect.provide(TestContext.TestContext),
        Effect.scoped,
        Effect.runPromise,
      );
    });

    it('should respect custom batchUpdates.spacing configuration', async () => {
      const mockEventHexes = await createMockEventHexes();
      const eventCount = 30;

      // Events arrive instantly (no delay)
      const mockSubscriptionFn = createMockSubscriptionFn(eventCount, mockEventHexes);

      const secretKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
      const initialState = CoreWallet.initEmpty(secretKeys, NetworkId.NetworkId.Undeployed);

      // With batch size 10 and 30 events, we get 3 batches.
      // With spacing of 500ms, the stream needs at least 1000ms (2 gaps between 3 batches)
      // to emit all batches. Advancing only 400ms should yield fewer than 3 batches.
      await Effect.gen(function* () {
        const syncService = makeEventsSyncService({
          indexerClientConnection: {
            indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
            indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
          },
          versionWatch: noVersionWatch,
          batchUpdates: { size: 10, spacing: 500 },
        });

        // Fork stream and only advance clock partially
        const streamFiber = yield* Effect.fork(syncService.updates(initialState, secretKeys).pipe(Stream.runCollect));

        // Advance just enough for the first batch but not all spacing gaps
        yield* TestClock.adjust(Duration.millis(400));
        const partialFiber = yield* Effect.fork(Fiber.poll(streamFiber));
        const partialResult = yield* Fiber.join(partialFiber);

        // Stream should still be running (not all batches emitted yet)
        expect(Option.isNone(partialResult)).toBe(true);

        // Now advance enough for all batches to complete
        yield* TestClock.adjust(Duration.seconds(5));
        const updates = yield* Fiber.join(streamFiber);

        expect(Chunk.size(updates)).toBe(3);
      }).pipe(
        Effect.provideService(ZswapEvents.tag, mockSubscriptionFn),
        Effect.provide(TestContext.TestContext),
        Effect.scoped,
        Effect.runPromise,
      );
    });

    it('should handle batching events by introducing a random delay', async () => {
      const minDelay = Duration.millis(500);
      const maxDelay = Duration.millis(1500);

      const mockEventHexes = await createMockEventHexes();
      const mockSubscriptionFn = createMockSubscriptionFn(numberOfEventsToProduce, mockEventHexes, {
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
            indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
            indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
          },
          versionWatch: noVersionWatch,
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

  describe('initial subscription cursor', () => {
    // Open one subscription against a recording stub and return the variables it was opened with. The
    // stub yields nothing, so the surrounding pipeline drains immediately.
    const cursorFor = async (
      state: CoreWallet,
      secretKeys: ledger.ZswapSecretKeys,
    ): Promise<ZswapEventsSubscriptionVariables | undefined> => {
      const recorded: { value?: ZswapEventsSubscriptionVariables } = {};
      const recordingFn = (variables: ZswapEventsSubscriptionVariables) => {
        recorded.value = variables;
        return Stream.empty as Stream.Stream<ZswapEventsSubscription, ClientError | ServerError, SubscriptionClient>;
      };

      const syncService = makeEventsSyncService({
        indexerClientConnection: {
          indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
          indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
        },
        versionWatch: noVersionWatch,
      });

      await syncService
        .updates(state, secretKeys)
        .pipe(Stream.runDrain, Effect.provideService(ZswapEvents.tag, recordingFn), Effect.scoped, Effect.runPromise);

      return recorded.value;
    };

    it('omits the id (null) for a fresh wallet so the indexer streams from the very start', async () => {
      const secretKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
      const state = CoreWallet.initEmpty(secretKeys, NetworkId.NetworkId.Undeployed);

      const variables = await cursorFor(state, secretKeys);

      expect(variables).toEqual({ id: null });
    });

    it('requests one below the applied index for a restored wallet so the boundary event is re-delivered', async () => {
      const secretKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
      const state = CoreWallet.updateProgress(CoreWallet.initEmpty(secretKeys, NetworkId.NetworkId.Undeployed), {
        appliedIndex: 5n,
      });

      const variables = await cursorFor(state, secretKeys);

      expect(variables).toEqual({ id: 4 });
    });
  });

  describe('per-item protocol version decoding', () => {
    // The version reported for a single event is what decides which side of the fork boundary that event falls on, so
    // it has to arrive at `applyUpdate` per item — a batch-level summary would erase exactly the transition being
    // looked for.
    const versionOf = (id: number): number => (id <= 3 ? 3 : id <= 5 ? 9 : 11);

    const collectUpdates = async (eventCount: number, batchSize: number) => {
      const mockEventHexes = await createMockEventHexes();
      const mockSubscriptionFn = createMockSubscriptionFn(eventCount, mockEventHexes, undefined, versionOf);
      const secretKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
      const initialState = CoreWallet.initEmpty(secretKeys, NetworkId.NetworkId.Undeployed);

      return await Effect.gen(function* () {
        const syncService = makeEventsSyncService({
          indexerClientConnection: {
            indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
            indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
          },
          versionWatch: noVersionWatch,
          batchUpdates: { size: batchSize, spacing: 0 },
        });

        return yield* syncService.updates(initialState, secretKeys).pipe(Stream.runCollect);
      }).pipe(Effect.provideService(ZswapEvents.tag, mockSubscriptionFn), Effect.scoped, Effect.runPromise);
    };

    it('carries the indexer-reported version of every event through a single batch', async () => {
      const updates = await collectUpdates(6, 10);

      expect(Chunk.size(updates)).toBe(1);
      const batch = updates.pipe(Chunk.unsafeHead);
      expect(eventsOf(batch).map((u) => u.id)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(eventsOf(batch).map((u) => u.protocolVersion)).toEqual([3, 3, 3, 9, 9, 11]);
    });

    it('keeps each event paired with its own version when the batch boundary splits them', async () => {
      const updates = await collectUpdates(6, 2);

      expect(Chunk.size(updates)).toBe(3);
      expect(Chunk.toArray(updates).map((batch) => eventsOf(batch).map((u) => u.protocolVersion))).toEqual([
        [3, 3],
        [3, 9],
        [9, 11],
      ]);
    });
  });

  describe('transaction boundaries', () => {
    const owner = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 5));
    const stranger = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 6));
    const networkId = NetworkId.NetworkId.Undeployed;
    const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

    type Chain = Readonly<{
      /** Every event of the chain in timeline order, encoded as the indexer serves it. */
      raws: readonly string[];
      mintHash: string;
      transferHash: string;
      strangerHash: string;
    }>;

    /**
     * A real chain of three transactions: a genesis mint paying the owner 500 (one event), a transfer spending it, 100
     * to a stranger and 400 back as change (an input then two outputs), and the stranger sending its 100 to itself (an
     * input then one output).
     */
    const buildChain = (): Promise<Chain> =>
      Effect.gen(function* () {
        const simulator = yield* V8.Simulator.init({
          genesisMints: [
            { type: 'shielded' as const, tokenType: ledger.shieldedToken().raw, amount: 500n, recipient: owner },
          ],
        });
        const lastBlockEvents = () =>
          simulator.state$.pipe(
            Stream.take(1),
            Stream.runHead,
            Effect.map(Option.getOrThrow),
            Effect.map(V8.getLastBlockEvents),
          );
        const send = (
          keys: ledger.ZswapSecretKeys,
          spentFrom: readonly ledger.Event[],
          outputs: readonly (readonly [bigint, ledger.ZswapSecretKeys])[],
        ) => {
          const local = new ledger.ZswapLocalState().replayEvents(
            keys,
            spentFrom.map((event) => ledger.Event.deserialize(event.serialize())),
          );
          const coin = [...local.coins][0];
          const [, input] = local.spend(keys, coin, 0);
          const offer = outputs.reduce(
            (acc, [value, to]) => {
              const info = ledger.createShieldedCoinInfo(coin.type, value);
              return acc.merge(
                ledger.ZswapOffer.fromOutput(
                  ledger.ZswapOutput.new(info, 0, to.coinPublicKey, to.encryptionPublicKey),
                  info.type,
                  info.value,
                ),
              );
            },
            ledger.ZswapOffer.fromInput(input, coin.type, coin.value),
          );
          return simulator.submitTransaction(ledger.Transaction.fromParts(networkId, offer).eraseProofs(), {
            strictness: {},
          });
        };

        const mint = yield* lastBlockEvents();
        yield* send(owner, mint, [
          [100n, stranger],
          [400n, owner],
        ]);
        const transfer = yield* lastBlockEvents();
        yield* send(stranger, [...mint, ...transfer], [[100n, stranger]]);
        const strangers = yield* lastBlockEvents();

        return {
          raws: [...mint, ...transfer, ...strangers].map((event) => hex(event.serialize())),
          mintHash: mint[0].source.transactionHash,
          transferHash: transfer[0].source.transactionHash,
          strangerHash: strangers[0].source.transactionHash,
        };
      }).pipe(Effect.scoped, Effect.runPromise);

    let chain: Chain;
    beforeAll(async () => {
      chain = await buildChain();
      // The test's premise: the size-3 batches the source would form by count alone cut the transfer after its input.
      expect(chain.raws.map((raw) => ledger.Event.deserialize(Buffer.from(raw, 'hex')).source.transactionHash)).toEqual(
        [
          chain.mintHash,
          chain.transferHash,
          chain.transferHash,
          chain.transferHash,
          chain.strangerHash,
          chain.strangerHash,
        ],
      );
    });

    /**
     * Serves `raws` with ids from 1, all at once, as an indexer serves a backlog whose last stored event is `maxId` (by
     * default the last of `raws`).
     */
    const subscriptionOf =
      (raws: readonly string[], maxId: number = raws.length) =>
      (
        _variables: ZswapEventsSubscriptionVariables,
      ): Stream.Stream<ZswapEventsSubscription, ClientError | ServerError, SubscriptionClient> =>
        Stream.fromIterable(
          raws.map((raw, i) => ({ zswapLedgerEvents: { id: i + 1, raw, protocolVersion: 3, maxId } })),
        );

    /** Syncs a fresh wallet through `subscription` with the given batch size, and returns each batch's event ids. */
    const batchesOf = (
      size: number,
      subscription: ReturnType<typeof subscriptionOf> = subscriptionOf(chain.raws),
    ): Promise<readonly (readonly number[])[]> =>
      Effect.gen(function* () {
        const syncService = makeEventsSyncService({
          indexerClientConnection: {
            indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
            indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
          },
          versionWatch: noVersionWatch,
          // A timeout no test reaches, so only the size and the transaction boundaries decide where a batch ends.
          batchUpdates: { size, timeout: 60_000, spacing: 0 },
        });
        const updates = yield* syncService
          .updates(CoreWallet.initEmpty(owner, networkId), owner)
          .pipe(Stream.runCollect);
        return Chunk.toArray(updates).map((update) => eventsOf(update).map((event) => event.id));
      }).pipe(Effect.provideService(ZswapEvents.tag, subscription), Effect.scoped, Effect.runPromise);

    it('should deliver none of a transaction the timeline ends part-way through, so the next sync fetches it whole rather than writing it in part', async () => {
      // The timeline ends after the mint and the transfer's input, while the indexer holds the chain up to its sixth
      // event: the transfer's outputs exist, and this run never received them.
      expect(await batchesOf(3, subscriptionOf(chain.raws.slice(0, 2), chain.raws.length))).toEqual([[1]]);
    });

    /**
     * Serves `raws` as {@link subscriptionOf} does, then keeps the subscription open with nothing more to send, as an
     * indexer does once it has served everything it holds.
     */
    const openSubscriptionOf =
      (raws: readonly string[], maxId: number = raws.length) =>
      (
        variables: ZswapEventsSubscriptionVariables,
      ): Stream.Stream<ZswapEventsSubscription, ClientError | ServerError, SubscriptionClient> =>
        subscriptionOf(raws, maxId)(variables).pipe(Stream.concat(Stream.never));

    /**
     * Syncs a fresh wallet through `subscription` under the test clock, lets `elapsed` pass, then stops the wallet.
     * Returns each batch delivered before the stop, as event ids.
     */
    const batchesBeforeStop = (
      subscription: ReturnType<typeof openSubscriptionOf>,
      batchUpdates: Readonly<{ size: number; timeout: number }>,
      elapsed: Duration.Duration,
    ): Promise<readonly (readonly number[])[]> =>
      Effect.gen(function* () {
        const batches = yield* Ref.make<readonly (readonly number[])[]>([]);
        const syncService = makeEventsSyncService({
          indexerClientConnection: {
            indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
            indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
          },
          versionWatch: noVersionWatch,
          batchUpdates: { ...batchUpdates, spacing: 0 },
        });
        const fiber = yield* syncService.updates(CoreWallet.initEmpty(owner, networkId), owner).pipe(
          Stream.runForEach((update) =>
            Ref.update(batches, (all) => [...all, eventsOf(update).map((event) => event.id)]),
          ),
          Effect.provideService(ZswapEvents.tag, subscription),
          Effect.fork,
        );
        yield* TestClock.adjust(elapsed);
        yield* Fiber.interrupt(fiber);
        return yield* Ref.get(batches);
      }).pipe(Effect.provide(TestContext.TestContext), Effect.scoped, Effect.runPromise);

    it('should deliver a transaction whose last event is the last the indexer holds without waiting for another, so a wallet at the tip applies it', async () => {
      // The mint and the transfer, and nothing after them: the transfer's last event (id 4) is the indexer's `maxId`.
      const batches = await batchesBeforeStop(
        openSubscriptionOf(chain.raws.slice(0, 4)),
        { size: 10, timeout: 100 },
        Duration.seconds(1),
      );

      expect(batches).toEqual([[1, 2, 3, 4]]);
    });

    it('should deliver a batch as soon as its whole transactions fill it, without waiting for the timeout', async () => {
      // The mint and the transfer fill a batch of four exactly, and the timeout is far beyond the time allowed.
      const batches = await batchesBeforeStop(
        openSubscriptionOf(chain.raws.slice(0, 4)),
        { size: 4, timeout: 60_000 },
        Duration.seconds(1),
      );

      expect(batches).toEqual([[1, 2, 3, 4]]);
    });

    it('should deliver a transaction larger than the batch size as soon as it is whole, without waiting for the timeout', async () => {
      // The transfer alone, served from id 1: three events against a size of two, and nothing after it.
      const batches = await batchesBeforeStop(
        openSubscriptionOf(chain.raws.slice(1, 4)),
        { size: 2, timeout: 60_000 },
        Duration.seconds(1),
      );

      expect(batches).toEqual([[1, 2, 3]]);
    });

    it('should deliver every event of a transaction in one batch, so the transaction is applied, and written to tx history, whole', async () => {
      // A batch of three cut by count would split the transfer (ids 2..4) after its first two events; the transfer
      // that fills the batch goes in whole instead, and the stranger's transaction (ids 5..6) starts the next.
      expect(await batchesOf(3)).toEqual([
        [1, 2, 3, 4],
        [5, 6],
      ]);
    });

    it('should deliver a transaction larger than the batch size whole, in the batch it fills, so it too is written to tx history once', async () => {
      // Ids 2..4 are the transfer: three events against a size of two.
      expect(await batchesOf(2)).toEqual([
        [1, 2, 3, 4],
        [5, 6],
      ]);
    });

    it('should write a transaction once, whole, after a restart, when the wallet stopped while only part of it had arrived', async () => {
      const activeRange = ProtocolVersion.makeRange(
        ProtocolVersion.ProtocolVersion(0n),
        ProtocolVersion.ProtocolVersion(7n),
      );
      const capability = makeEventsSyncCapability();
      const eventOf = (raw: string, i: number) => ({
        zswapLedgerEvents: { id: i + 1, raw, protocolVersion: 3, maxId: chain.raws.length },
      });

      /**
       * Syncs from `wallet` through the capability until the stream has gone quiet, then stops the wallet. Returns the
       * state it stopped at and every change handed to tx history on the way.
       */
      const runUntilStopped = (
        wallet: CoreWallet,
        subscription: (
          variables: ZswapEventsSubscriptionVariables,
        ) => Stream.Stream<ZswapEventsSubscription, ClientError | ServerError, SubscriptionClient>,
      ) =>
        Effect.gen(function* () {
          const state = yield* Ref.make(wallet);
          const written = yield* Ref.make<readonly ledger.ZswapStateChanges[]>([]);
          const syncService = makeEventsSyncService({
            indexerClientConnection: {
              indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
              indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
            },
            versionWatch: noVersionWatch,
            batchUpdates: { size: 3, timeout: 100, spacing: 0 },
          });
          const fiber = yield* syncService.updates(wallet, owner).pipe(
            Stream.runForEach((update) =>
              Effect.gen(function* () {
                const [next, { changes }] = capability.applyUpdate(yield* Ref.get(state), update, activeRange);
                yield* Ref.set(state, next);
                yield* Ref.update(written, (all) => [...all, ...changes]);
              }),
            ),
            Effect.provideService(ZswapEvents.tag, subscription),
            Effect.fork,
          );
          yield* TestClock.adjust(Duration.seconds(1));
          yield* Fiber.interrupt(fiber);
          return [yield* Ref.get(state), yield* Ref.get(written)] as const;
        }).pipe(Effect.provide(TestContext.TestContext), Effect.scoped, Effect.runPromise);

      // The indexer has served the mint and the transfer's input, and the transfer's outputs are still on their way
      // when the wallet stops.
      const [stopped, writtenBeforeStop] = await runUntilStopped(CoreWallet.initEmpty(owner, networkId), () =>
        Stream.fromIterable(chain.raws.slice(0, 2).map(eventOf)).pipe(Stream.concat(Stream.never)),
      );
      // The restarted wallet resumes from the state it stopped at, and the indexer serves from its cursor on.
      const [, writtenAfterRestart] = await runUntilStopped(stopped, (variables) =>
        Stream.fromIterable(
          chain.raws.map(eventOf).filter((event) => event.zswapLedgerEvents.id >= (variables.id ?? 1)),
        ),
      );

      const transferWrites = [...writtenBeforeStop, ...writtenAfterRestart]
        .filter((changes) => changes.source === chain.transferHash)
        .map((changes) => ({
          spent: changes.spentCoins.map((coin) => coin.value),
          received: changes.receivedCoins.map((coin) => coin.value),
        }));
      expect(transferWrites).toEqual([{ spent: [500n], received: [400n] }]);
    });
  });
});
