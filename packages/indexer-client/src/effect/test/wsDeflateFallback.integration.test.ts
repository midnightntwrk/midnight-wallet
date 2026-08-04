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
import { makeComposeEnvironment, timeoutMinutes } from './composeEnvironment.js';
import { WsSubscriptionClient } from '../index.js';
import { emptyWireStats, makeCountingWebSocket, report, savingsRatio, type WireStats } from './deflateWireStats.js';

// The ws-no-deflate override freezes the last pre-deflate indexer (4.3.x) — exactly the
// scenario under test — so this keeps working no matter what the compose default moves to.
const environment = makeComposeEnvironment(['docker-compose.yml', 'docker-compose.ws-no-deflate.yml']);

describe('WebSocket deflate compression fallback', () => {
  describe('with an Indexer Server that predates the deflate subprotocol', () => {
    beforeAll(() => environment.start(), timeoutMinutes(3));

    afterAll(() => environment.stop(), timeoutMinutes(1));

    it(
      'should fall back to the standard protocol and deliver everything uncompressed',
      async ({ annotate }) => {
        const stats: WireStats = emptyWireStats();

        // Note: `compression` is NOT set — this proves the out-of-the-box default (deflate
        // offered) degrades gracefully against an old indexer.
        const events = await ZswapEvents.run({ id: 0 }).pipe(
          Stream.takeUntil(({ zswapLedgerEvents: e }) => e.id >= e.maxId),
          Stream.runCollect,
          Effect.map(Chunk.toReadonlyArray),
          Effect.provide(
            WsSubscriptionClient.layer(
              { url: `ws://127.0.0.1:${environment.getIndexerPort()}/api/v4/graphql/ws` },
              { webSocketImpl: makeCountingWebSocket(stats) },
            ),
          ),
          Effect.scoped,
          Effect.runPromise,
        );

        // The server declined the offered deflate variant and picked the standard protocol.
        expect(stats.protocol).toBe('graphql-transport-ws');

        // Everything arrives as plain text — the deflate wrapper is a pass-through — and the
        // subscription behaves exactly as before the compression feature existed. Nothing was
        // compressed, so there is nothing to save: the counterpart to the savings floor the
        // deflate tests assert.
        expect(stats.frames.some((f) => f.binary)).toBe(false);
        expect(savingsRatio(stats)).toBe(0);
        expect(events.length).toBeGreaterThan(0);
        // Replay is ordered: ids grow strictly. The exact numbering is the server's business —
        // the first id and any gaps between ids are version-dependent, so density (+1 steps) is
        // deliberately not asserted.
        events.slice(1).forEach(({ zswapLedgerEvents: e }, index) => {
          expect(e.id).toBeGreaterThan(events[index].zswapLedgerEvents.id);
        });
        // ...and complete: the stream only ends once the server-declared tip is reached.
        const lastEvent = events[events.length - 1].zswapLedgerEvents;
        expect(lastEvent.id).toBeGreaterThanOrEqual(lastEvent.maxId);

        // Fallback delivery matches what a client that never offered deflate receives: same
        // events, same order. This pins the actual contract — "behaves exactly as before the
        // compression feature existed" — against a reference run instead of assumptions about
        // the server's id numbering.
        const referenceEvents = await ZswapEvents.run({ id: 0 }).pipe(
          Stream.takeUntil(({ zswapLedgerEvents: e }) => e.id >= e.maxId),
          Stream.runCollect,
          Effect.map(Chunk.toReadonlyArray),
          Effect.provide(
            WsSubscriptionClient.layer(
              { url: `ws://127.0.0.1:${environment.getIndexerPort()}/api/v4/graphql/ws` },
              { compression: false },
            ),
          ),
          Effect.scoped,
          Effect.runPromise,
        );
        expect(events.map(({ zswapLedgerEvents: e }) => e.id)).toEqual(
          referenceEvents.map(({ zswapLedgerEvents: e }) => e.id),
        );

        await report(annotate, `fallback (indexer without deflate, protocol=${stats.protocol})`, events.length, stats);
      },
      timeoutMinutes(1),
    );
  });
});
