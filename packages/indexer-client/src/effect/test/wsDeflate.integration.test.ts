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
import { Chunk, Effect, Stream } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DustLedgerEvents } from '../../graphql/subscriptions/DustLedgerEvents.js';
import { ZswapEvents } from '../../graphql/subscriptions/ZswapEvents.js';
import { GRAPHQL_TRANSPORT_WS_DEFLATE } from '../DeflateWebSocket.js';
import { makeComposeEnvironment, timeoutMinutes } from './composeEnvironment.js';
import { WsSubscriptionClient } from '../index.js';
import {
  annotateAll,
  emptyWireStats,
  makeCountingWebSocket,
  report,
  savingsRatio,
  type WireStats,
} from './deflateWireStats.js';

/**
 * The floor every compressed replay stream must clear. Deliberately well below what these streams actually achieve
 * (comfortably above a third of the wire), because the exact ratio depends on how the local test chain's data happens
 * to compress and drifts with indexer and node versions. What this guards is compression silently breaking — a wrapper
 * that stops negotiating the subprotocol, or a server that stops compressing, collapses the ratio to roughly zero.
 */
const MIN_SAVINGS_RATIO = 0.25;

/**
 * Mirrors the server's documented compression threshold: messages at or above this size arrive as compressed binary
 * frames, smaller ones legitimately stay plain text. The assertions target this wire contract rather than counting
 * events — per-event counting would fail the day any single event happens to serialize under the threshold, even though
 * compression is working exactly as specified.
 */
const SERVER_COMPRESSION_THRESHOLD_B = 256;

// The compose default (indexer >= 4.4.0) offers the deflate subprotocol out of the box; the
// pre-deflate scenario lives in wsDeflateFallback.integration.test.ts via its own override.
const environment = makeComposeEnvironment('docker-compose.yml');

describe('WebSocket deflate compression', () => {
  describe('with available Indexer Server', () => {
    beforeAll(() => environment.start(), timeoutMinutes(3));

    afterAll(() => environment.stop(), timeoutMinutes(1));

    // Drains the full backlog: replays every event from id 0 and stops once caught up with
    // maxId — bounded by data, not wall-clock time.
    const collectEvents = (compression: boolean, stats: WireStats) =>
      ZswapEvents.run({ id: 0 }).pipe(
        Stream.takeUntil(({ zswapLedgerEvents: e }) => e.id >= e.maxId),
        Stream.runCollect,
        Effect.map(Chunk.toReadonlyArray),
        Effect.provide(
          WsSubscriptionClient.layer(
            { url: `ws://127.0.0.1:${environment.getIndexerPort()}/api/v4/graphql/ws` },
            { compression, webSocketImpl: makeCountingWebSocket(stats) },
          ),
        ),
        Effect.scoped,
        Effect.runPromise,
      );

    it(
      'should negotiate deflate, deliver identical data, and reduce bytes over the wire',
      async ({ annotate }) => {
        const plain: WireStats = emptyWireStats();
        const deflate: WireStats = emptyWireStats();

        const plainEvents = await collectEvents(false, plain);
        const deflateEvents = await collectEvents(true, deflate);

        expect(plain.protocol).toBe('graphql-transport-ws');
        expect(plain.frames.some((f) => f.binary)).toBe(false);
        expect(deflate.protocol).toBe(GRAPHQL_TRANSPORT_WS_DEFLATE);

        // Same replay from id 0 → identical payloads after inflation. maxId may move between
        // runs, so compare the stable fields only.
        const stable = (events: typeof plainEvents) =>
          events.map(({ zswapLedgerEvents: e }) => ({ id: e.id, raw: e.raw }));
        expect(stable(deflateEvents)).toEqual(stable(plainEvents));

        // The wire contract: every frame at or above the server's threshold arrived compressed,
        // each one genuinely smaller than its inflated form.
        const compressed = deflate.frames.filter((f) => f.binary);
        expect(compressed.length).toBeGreaterThan(0);
        deflate.frames
          .filter((f) => f.inflated >= SERVER_COMPRESSION_THRESHOLD_B)
          .forEach((f) => expect(f.binary).toBe(true));
        compressed.forEach((f) => expect(f.wire).toBeLessThan(f.inflated));

        // ...and the run as a whole cleared the savings floor.
        expect(savingsRatio(deflate)).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO);

        await report(annotate, 'backlog drain (single subscription)', deflateEvents.length, deflate, plain);
      },
      timeoutMinutes(1),
    );

    it(
      'should compress the dust sync stream (issue #462: dust replay dominates indexer egress)',
      async ({ annotate }) => {
        const plain: WireStats = emptyWireStats();
        const deflate: WireStats = emptyWireStats();

        // The dust ledger event replay is the stream a fresh dust-wallet sync drains (~1M
        // events in production), i.e. the dominant egress named in the ticket.
        const collectDustEvents = (compression: boolean, stats: WireStats) =>
          DustLedgerEvents.run({ id: 0 }).pipe(
            Stream.takeUntil(({ dustLedgerEvents: e }) => e.id >= e.maxId),
            Stream.runCollect,
            Effect.map(Chunk.toReadonlyArray),
            Effect.provide(
              WsSubscriptionClient.layer(
                { url: `ws://127.0.0.1:${environment.getIndexerPort()}/api/v4/graphql/ws` },
                { compression, webSocketImpl: makeCountingWebSocket(stats) },
              ),
            ),
            Effect.scoped,
            Effect.runPromise,
          );

        const plainEvents = await collectDustEvents(false, plain);
        const deflateEvents = await collectDustEvents(true, deflate);

        expect(deflate.protocol).toBe(GRAPHQL_TRANSPORT_WS_DEFLATE);

        const stable = (events: typeof plainEvents) =>
          events.map(({ dustLedgerEvents: e }) => ({ id: e.id, raw: e.raw }));
        expect(stable(deflateEvents)).toEqual(stable(plainEvents));

        // Same wire contract as the zswap test: threshold-or-above frames are compressed.
        const compressed = deflate.frames.filter((f) => f.binary);
        expect(compressed.length).toBeGreaterThan(0);
        deflate.frames
          .filter((f) => f.inflated >= SERVER_COMPRESSION_THRESHOLD_B)
          .forEach((f) => expect(f.binary).toBe(true));
        compressed.forEach((f) => expect(f.wire).toBeLessThan(f.inflated));

        expect(savingsRatio(deflate)).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO);

        await report(annotate, 'dust sync stream (dustLedgerEvents replay)', deflateEvents.length, deflate, plain);
      },
      timeoutMinutes(1),
    );

    it(
      'should hold the savings under high volume (20 concurrent subscriptions on one socket)',
      async ({ annotate }) => {
        const plain: WireStats = emptyWireStats();
        const deflate: WireStats = emptyWireStats();

        await drainConcurrently(false, plain);
        const deflateEvents = await drainConcurrently(true, deflate);

        expect(deflate.protocol).toBe(GRAPHQL_TRANSPORT_WS_DEFLATE);
        expect(deflateEvents).toHaveLength(REPLAY_COUNT);
        deflateEvents.forEach((events) => expect(events.length).toBeGreaterThan(0));

        // All of it multiplexed over a single physical connection.
        expect(deflate.sockets).toBe(1);

        const eventCount = deflateEvents.reduce((sum, events) => sum + events.length, 0);
        // Same wire contract as above, held under concurrency: threshold-or-above frames compressed.
        const compressed = deflate.frames.filter((f) => f.binary);
        expect(compressed.length).toBeGreaterThan(0);
        deflate.frames
          .filter((f) => f.inflated >= SERVER_COMPRESSION_THRESHOLD_B)
          .forEach((f) => expect(f.binary).toBe(true));
        compressed.forEach((f) => expect(f.wire).toBeLessThan(f.inflated));

        // The savings hold at volume, not just on a single quiet subscription.
        expect(savingsRatio(deflate)).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO);

        await report(annotate, `high volume (${REPLAY_COUNT} concurrent replays)`, eventCount, deflate, plain);
      },
      timeoutMinutes(2),
    );

    // One full subscribe → drain → unsubscribe round trip: after it the client has zero active
    // subscriptions, exactly like a backpressure pause.
    const drainOnce = ZswapEvents.run({ id: 0 }).pipe(
      Stream.takeUntil(({ zswapLedgerEvents: e }) => e.id >= e.maxId),
      Stream.runDrain,
    );

    it(
      'should reuse the warm connection across repeated disconnect/wait/resubscribe cycles',
      async ({ annotate }) => {
        const stats: WireStats = emptyWireStats();
        const CYCLES = 5;
        const GAP_MS = 200;

        // Each cycle fully tears the subscription down, then idles with the connection unused
        // before subscribing again — the shape of a backpressure pause/resume.
        await Effect.gen(function* () {
          yield* drainOnce;
          yield* Effect.repeat(Effect.sleep(`${GAP_MS} millis`).pipe(Effect.zipRight(drainOnce)), {
            times: CYCLES - 2,
          });
          yield* Effect.sleep(`${GAP_MS} millis`);
          yield* drainOnce;
        }).pipe(
          Effect.provide(
            WsSubscriptionClient.layer(
              { url: `ws://127.0.0.1:${environment.getIndexerPort()}/api/v4/graphql/ws` },
              { webSocketImpl: makeCountingWebSocket(stats) },
            ),
          ),
          Effect.scoped,
          Effect.runPromise,
        );

        // All cycles ride one physical connection — the client holds it for its whole scope
        // (lazy: false), which is what makes backpressure pause/resume cycles cheap. A client
        // closing at zero subscriptions would open CYCLES connections here.
        expect(stats.sockets).toBe(1);
        expect(stats.protocol).toBe(GRAPHQL_TRANSPORT_WS_DEFLATE);

        await annotateAll(annotate, [
          'ws connection reuse (connection held for the client scope)',
          `disconnect/wait/resubscribe cycles: ${CYCLES} (${GAP_MS} ms idle gap each)`,
          `physical connections: ${stats.sockets} — all cycles reused one connection ` +
            `(a lazily-closing client would have opened ${CYCLES})`,
          `protocol: ${stats.protocol}`,
        ]);
      },
      timeoutMinutes(1),
    );

    // NOTE: there is deliberately no idle-expiry test anymore. The client holds its connection
    // for its whole scope (lazy: false) — connections are bounded by client lifetime, not by an
    // idle window — and "disposal closes the connection and cancels every timer" is pinned by a
    // unit test in wsSubscriptionClient.test.ts.

    /**
     * Multiplexes many full-backlog replays over a single WebSocket connection — the graphql-ws protocol runs
     * concurrent operations on one socket — so a large data volume flows through one connection without waiting on
     * chain growth.
     */
    const REPLAY_COUNT = 20;
    const drainConcurrently = (compression: boolean, stats: WireStats) =>
      Effect.all(
        Array.from({ length: REPLAY_COUNT }, () =>
          ZswapEvents.run({ id: 0 }).pipe(
            Stream.takeUntil(({ zswapLedgerEvents: e }) => e.id >= e.maxId),
            Stream.runCollect,
            Effect.map(Chunk.toReadonlyArray),
          ),
        ),
        { concurrency: 'unbounded' },
      ).pipe(
        Effect.provide(
          WsSubscriptionClient.layer(
            { url: `ws://127.0.0.1:${environment.getIndexerPort()}/api/v4/graphql/ws` },
            { compression, webSocketImpl: makeCountingWebSocket(stats) },
          ),
        ),
        Effect.scoped,
        Effect.runPromise,
      );
  });
});
