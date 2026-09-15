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

/**
 * Proves the transport split for one-shot GraphQL calls:
 *
 * - HTTP queries reuse pooled keep-alive TCP connections across requests — the wallet's 1 Hz `TransactionStatus` poll
 *   does NOT reconnect per request.
 * - The HTTP pool and the subscription WebSocket are separate connections by construction: a WebSocket is an upgraded TCP
 *   socket speaking only WS frames, so `fetch` can never reuse it.
 *
 * Physical connections are observed via Node's `diagnostics_channel`: undici (the engine behind the global `fetch`)
 * publishes `undici:client:connected` for every real TCP connect.
 */
import { Effect, Layer, Stream } from 'effect';
import diagnostics from 'node:diagnostics_channel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlockHash } from '../../graphql/queries/BlockHash.js';
import { ZswapEvents } from '../../graphql/subscriptions/ZswapEvents.js';
import { makeComposeEnvironment, timeoutMinutes } from './composeEnvironment.js';
import { HttpQueryClient, WsSubscriptionClient } from '../index.js';
import { annotateAll, emptyWireStats, makeCountingWebSocket, type WireStats } from './deflateWireStats.js';

const environment = makeComposeEnvironment('docker-compose.yml');

/**
 * Counts real TCP connections opened by undici (global fetch and friends) towards a port.
 *
 * The accumulator is mutable by necessity: `diagnostics_channel` delivers events through a callback over the life of
 * the test, so there is nothing to fold over. Permitted for test instrumentation by
 * `.claude/rules/functional-style.md`, and confined to this helper — callers see only `count`/`stop`.
 */
const trackConnections = (port: number): { count: () => number; stop: () => void } => {
  const seen: unknown[] = [];
  const onConnect = (message: unknown): void => {
    // Type cast required because: diagnostics_channel payloads are untyped by design; the
    // undici event shape is stable and documented (connectParams.port as string).
    const params = (message as { connectParams?: { port?: string | number } }).connectParams;
    if (Number(params?.port) === port) seen.push(message);
  };
  diagnostics.subscribe('undici:client:connected', onConnect);
  return {
    count: () => seen.length,
    stop: () => diagnostics.unsubscribe('undici:client:connected', onConnect),
  };
};

describe('HTTP connection reuse for one-shot GraphQL calls', () => {
  describe('with available Indexer Server', () => {
    beforeAll(() => environment.start(), timeoutMinutes(3));

    afterAll(() => environment.stop(), timeoutMinutes(1));

    it(
      'should reuse one pooled connection for sequential queries and stay off the WebSocket',
      async ({ annotate }) => {
        const port = environment.getIndexerPort();
        const connections = trackConnections(port);
        const wsStats: WireStats = emptyWireStats();
        const SEQUENTIAL = 10;
        const CONCURRENT = 10;

        const burst = (count: number) =>
          Effect.all(
            Array.from({ length: count }, () => BlockHash.run({ offset: null })),
            { concurrency: 'unbounded' },
          );

        // Paced like the wallet's real poll (which ticks every 1 s). The gap keeps the
        // connection count low: undici returns a socket to the pool a beat after the response
        // completes, so a zero-gap follow-up can race past it and open a second socket — a pool
        // artifact, not a reconnect.
        const poll = (count: number) =>
          Effect.all(
            Array.from({ length: count }, (_, i) =>
              (i === 0 ? Effect.void : Effect.sleep('50 millis')).pipe(
                Effect.zipRight(BlockHash.run({ offset: null })),
              ),
            ),
            { concurrency: 1 },
          );

        try {
          const observed = await Effect.gen(function* () {
            // Open the subscription WebSocket first; the client holds it open for its whole
            // scope, so any accidental transport sharing would surface below. Its connect may
            // itself register on the undici channel, hence the baseline.
            yield* ZswapEvents.run({ id: 0 }).pipe(Stream.take(1), Stream.runDrain);
            const baseline = connections.count();

            // Paced sequential queries — the shape of the wallet's 1 Hz TransactionStatus poll.
            const sequential = yield* poll(SEQUENTIAL);
            const afterSequential = connections.count();

            // Concurrent burst — independent requests; the pool may add sockets.
            const concurrent = yield* burst(CONCURRENT);
            const afterBurst = connections.count();

            // Poll again — the pool must serve these from already-open sockets.
            yield* poll(SEQUENTIAL);
            const afterReuse = connections.count();

            // Idle past undici's keep-alive window (default 4 s): the pooled sockets close,
            // and the next query pays a fresh TCP connect — the HTTP counterpart of the WS
            // warm-window expiry.
            yield* Effect.sleep('5 seconds');
            yield* poll(1);
            const afterIdleExpiry = connections.count();

            return { sequential, concurrent, baseline, afterSequential, afterBurst, afterReuse, afterIdleExpiry };
          }).pipe(
            // One merged provide rather than two chained ones: the transports are independent, and a
            // single provide keeps their scopes siblings instead of nesting one inside the other.
            Effect.provide(
              Layer.merge(
                HttpQueryClient.layer({ url: `http://127.0.0.1:${port}/api/v4/graphql` }),
                WsSubscriptionClient.layer(
                  { url: `ws://127.0.0.1:${port}/api/v4/graphql/ws` },
                  { webSocketImpl: makeCountingWebSocket(wsStats) },
                ),
              ),
            ),
            Effect.scoped,
            Effect.runPromise,
          );

          const { sequential, concurrent, baseline, afterSequential, afterBurst, afterReuse, afterIdleExpiry } =
            observed;

          // Every request answered.
          expect(sequential).toHaveLength(SEQUENTIAL);
          expect(concurrent).toHaveLength(CONCURRENT);
          sequential.concat(concurrent).forEach((r) => expect(r.block?.hash).toBeTruthy());

          // Sequential requests ride pooled keep-alive connections — no per-request reconnect
          // (this is the wallet's polling shape). Reuse means O(1) sockets regardless of request
          // count; the small bound tolerates a pool race on a slow runner (a socket not yet back
          // in the pool when the next paced request lands) while a reconnect-per-request
          // regression would open all SEQUENTIAL connections and still fail loudly.
          expect(afterSequential - baseline).toBeGreaterThanOrEqual(1);
          expect(afterSequential - baseline).toBeLessThanOrEqual(3);

          // After the burst, further sequential queries are served from the already-open pool.
          // At most one fresh socket is tolerated: the first post-burst request can race a busy
          // socket's return to the pool — a pool artifact, not a torn-down-per-request pool.
          expect(afterReuse - afterBurst).toBeLessThanOrEqual(1);

          // The idle-expiry phase is measured and reported below but deliberately NOT asserted:
          // whether the pooled socket expired (one fresh connect) or survived the 5 s idle
          // (zero — e.g. a server keep-alive hint stretching undici's default 4 s window) is
          // library/server timing, not the transport-split contract under test. `poll(1)`
          // bounds it to 0 or 1 by construction.

          // And none of it rode the WebSocket: exactly one WS connection carrying only the
          // subscription — HTTP cannot reuse an upgraded socket, and provably didn't.
          expect(wsStats.sockets).toBe(1);

          await annotateAll(annotate, [
            'http connection reuse (one-shot GraphQL calls)',
            `sequential queries: ${SEQUENTIAL} requests → ${afterSequential - baseline} TCP connection (keep-alive reuse)`,
            `concurrent burst: ${CONCURRENT} requests → ${afterBurst - afterSequential} extra pooled connection(s)`,
            `sequential after burst: ${SEQUENTIAL} requests → ${afterReuse - afterBurst} new connections (pool reused)`,
            `after 5 s idle: 1 request → ${afterIdleExpiry - afterReuse} new connection (keep-alive window ~4 s expired)`,
            `websocket connections: ${wsStats.sockets} (subscription only — HTTP never rides the WS socket)`,
          ]);
        } finally {
          connections.stop();
        }
      },
      timeoutMinutes(1),
    );
  });
});
