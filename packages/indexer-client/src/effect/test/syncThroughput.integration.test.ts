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
import { ZswapEvents } from '../../graphql/subscriptions/ZswapEvents.js';
import { GRAPHQL_TRANSPORT_WS_DEFLATE } from '../DeflateWebSocket.js';
import { makeComposeEnvironment, timeoutMinutes } from './composeEnvironment.js';
import { WsSubscriptionClient } from '../index.js';
import { startThrottledProxy } from './throttledProxy.js';
import {
  annotateAll,
  emptyWireStats,
  makeCountingWebSocket,
  savingsRatio,
  total,
  type WireStats,
} from './deflateWireStats.js';

/**
 * Sync time over a bandwidth-limited link — the claim behind "compression speeds up sync".
 *
 * Between local containers the wire is effectively infinite, so plain and deflate drains take the same time and any
 * timing comparison is noise. Real wallets sync over links where the wire IS the bottleneck; the throttled proxy
 * recreates that regime deliberately, which is the only regime where byte savings can convert into time savings. The
 * assertion is strictly relative — deflate vs plain, same server, same link — because absolute durations depend on
 * machine load and would flake.
 */

/** The simulated client link: ~1 Mbit/s, slow enough that transfer dominates the drain. */
const LINK_BYTES_PER_SECOND = 128 * 1024;

/**
 * Replays multiplexed on one socket — the data-volume multiplier (no chain setup needed). Indexer 4.4.0 introduced a
 * per-connection subscription cap of exactly 20 ("subscription limit exceeded" beyond it), so this sits at that cap;
 * the slower link above compensates for the bounded volume to keep the drain transfer-dominated.
 */
const REPLAY_COUNT = 20;

/**
 * The floor on the relative time saving. Theory says the saving approaches the byte savings ratio (~37-45% on these
 * streams) as the link saturates; 15% is a wide margin below that, so the test only fails when compression genuinely
 * stops converting bytes into time.
 */
const MIN_TIME_SAVING = 0.15;

const drainThrough = (proxyPort: number, compression: boolean, stats: WireStats, replays: number = REPLAY_COUNT) =>
  Effect.all(
    Array.from({ length: replays }, () =>
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
        { url: `ws://127.0.0.1:${proxyPort}/api/v4/graphql/ws` },
        { compression, webSocketImpl: makeCountingWebSocket(stats) },
      ),
    ),
    Effect.scoped,
    Effect.runPromise,
  );

/**
 * Sequential batches of {@link REPLAY_COUNT} replays, each on a fresh connection (the per-connection subscription cap
 * rules out widening a single drain) — the depth multiplier for long-duration measurements. 1 keeps the routine CI run
 * short; raise it locally to watch the saving hold over minutes of wall-clock sync.
 */
const BATCHES = 1;

interface TimedDrain {
  readonly elapsedMs: number;
  readonly events: number;
  readonly stats: WireStats;
}

const timedDrain = async (proxyPort: number, compression: boolean): Promise<TimedDrain> => {
  const stats = emptyWireStats();
  const startedAt = performance.now();
  const batchResults = await Array.from({ length: BATCHES }).reduce<Promise<number>>(
    (queued) =>
      queued.then(async (sum) => {
        const replays = await drainThrough(proxyPort, compression, stats);
        return sum + replays.reduce((batchSum, events) => batchSum + events.length, 0);
      }),
    Promise.resolve(0),
  );
  const elapsedMs = performance.now() - startedAt;
  return { elapsedMs, events: batchResults, stats };
};

const throughputLine = (label: string, run: TimedDrain): string => {
  const wireBytes = total(run.stats.frames, (f) => f.wire);
  return (
    `${label}: ${run.events} events, ${wireBytes} B on the wire in ${Math.round(run.elapsedMs)} ms ` +
    `(${Math.round(wireBytes / (run.elapsedMs / 1_000))} B/s effective)`
  );
};

describe('sync throughput over a bandwidth-limited link', () => {
  describe('deflate-capable indexer (compose default)', () => {
    const environment = makeComposeEnvironment('docker-compose.yml');

    beforeAll(() => environment.start(), timeoutMinutes(3));

    afterAll(() => environment.stop(), timeoutMinutes(1));

    it(
      `drains the replay at least ${MIN_TIME_SAVING * 100}% faster with compression`,
      async ({ annotate }) => {
        const proxy = await startThrottledProxy({
          targetHost: '127.0.0.1',
          targetPort: environment.getIndexerPort(),
          bytesPerSecond: LINK_BYTES_PER_SECOND,
        });
        try {
          // Light untimed warm-up so first-connection effects (server caches, JIT) hit neither
          // measured run.
          await drainThrough(proxy.port, false, emptyWireStats(), 2);

          const plain = await timedDrain(proxy.port, false);
          const deflate = await timedDrain(proxy.port, true);

          // Fair comparison preconditions: same data volume, and each run really used the
          // protocol it claims to measure.
          expect(plain.events).toBe(deflate.events);
          expect(plain.stats.protocol).toBe('graphql-transport-ws');
          expect(deflate.stats.protocol).toBe(GRAPHQL_TRANSPORT_WS_DEFLATE);
          expect(savingsRatio(deflate.stats)).toBeGreaterThan(0);

          // The claim under test: on a link where transfer dominates, byte savings convert
          // into time savings.
          expect(deflate.elapsedMs).toBeLessThanOrEqual(plain.elapsedMs * (1 - MIN_TIME_SAVING));

          const saved = 1 - deflate.elapsedMs / plain.elapsedMs;
          await annotateAll(annotate, [
            `sync throughput — ${REPLAY_COUNT} multiplexed replays over a ${LINK_BYTES_PER_SECOND} B/s link`,
            throughputLine('plain  ', plain),
            throughputLine('deflate', deflate),
            `time saved: ${(100 * saved).toFixed(1)}% (byte savings this run: ${(100 * savingsRatio(deflate.stats)).toFixed(1)}%)`,
          ]);
        } finally {
          await proxy.stop();
        }
      },
      timeoutMinutes(3),
    );
  });

  describe('pre-deflate indexer (4.3.x baseline)', () => {
    const environment = makeComposeEnvironment(['docker-compose.yml', 'docker-compose.ws-no-deflate.yml']);

    beforeAll(() => environment.start(), timeoutMinutes(3));

    afterAll(() => environment.stop(), timeoutMinutes(1));

    // Evidence only, deliberately unasserted against the run above: a timing delta between
    // indexer versions mixes compression with whatever else changed server-side, so it is
    // recorded for the comparison table but never gated on.
    it(
      'records the baseline drain time of the previous indexer version',
      async ({ annotate }) => {
        const proxy = await startThrottledProxy({
          targetHost: '127.0.0.1',
          targetPort: environment.getIndexerPort(),
          bytesPerSecond: LINK_BYTES_PER_SECOND,
        });
        try {
          await drainThrough(proxy.port, false, emptyWireStats(), 2); // warm-up, untimed
          const baseline = await timedDrain(proxy.port, false);

          expect(baseline.events).toBeGreaterThan(0);
          expect(baseline.stats.protocol).toBe('graphql-transport-ws');

          await annotateAll(annotate, [
            `sync throughput baseline — indexer 4.3.x, ${REPLAY_COUNT} multiplexed replays over a ${LINK_BYTES_PER_SECOND} B/s link`,
            throughputLine('plain  ', baseline),
          ]);
        } finally {
          await proxy.stop();
        }
      },
      timeoutMinutes(3),
    );
  });
});
