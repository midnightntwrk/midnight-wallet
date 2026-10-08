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
import { Cause, Effect, Exit, Stream } from 'effect';
import { parse } from 'graphql';
import { GRAPHQL_TRANSPORT_WS_PROTOCOL } from 'graphql-ws';
import { describe, expect, it, vi } from 'vitest';
import { type Query } from '../Query.js';
import * as SubscriptionClient from '../SubscriptionClient.js';
import * as WsSubscriptionClient from '../WsSubscriptionClient.js';

/**
 * A `typeof WebSocket` stand-in that opens no connection but completes the graphql-transport-ws handshake (ack on init)
 * and immediately completes any subscription, so a full connect → subscribe → complete → dispose cycle can run without
 * a network.
 *
 * Mutation is deliberate and confined to this test fake: graphql-ws drives the socket through handler assignments and
 * state reads, so mimicking it is inherently stateful (`.claude/rules/functional-style.md` permits this for test
 * setup).
 */
const makeHandshakeFake = (): typeof WebSocket => {
  class HandshakeFakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readyState = HandshakeFakeWebSocket.CONNECTING;
    protocol = GRAPHQL_TRANSPORT_WS_PROTOCOL;
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;

    constructor() {
      void Promise.resolve().then(() => {
        this.readyState = HandshakeFakeWebSocket.OPEN;
        this.onopen?.();
      });
    }

    send(data: string): void {
      const message = JSON.parse(data) as { readonly type: string; readonly id?: string };
      const reply = (payload: object): void =>
        void Promise.resolve().then(() =>
          this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) })),
        );
      if (message.type === 'connection_init') reply({ type: 'connection_ack' });
      if (message.type === 'subscribe') reply({ id: message.id, type: 'complete' });
    }

    close(code?: number, reason?: string): void {
      this.readyState = HandshakeFakeWebSocket.CLOSED;
      this.onclose?.({ code: code ?? 1000, reason: reason ?? '', wasClean: true });
    }
  }

  // Type cast required because: `typeof WebSocket` describes the full DOM constructor, while
  // graphql-ws only ever touches the members implemented above.
  return HandshakeFakeWebSocket as unknown as typeof WebSocket;
};

/**
 * A `typeof WebSocket` stand-in whose connection always fails, mimicking an unreachable server: the constructor reports
 * error + close on the next microtask, as undici does when nothing is listening. Mutation confined to test setup, as
 * with the handshake fake above.
 */
const makeUnreachableFake = (): typeof WebSocket => {
  class UnreachableFakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readyState = UnreachableFakeWebSocket.CONNECTING;
    protocol = '';
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;

    constructor() {
      void Promise.resolve().then(() => {
        this.readyState = UnreachableFakeWebSocket.CLOSED;
        this.onerror?.(new Event('error'));
        this.onclose?.({ code: 1006, reason: '', wasClean: false });
      });
    }

    send(): void {}

    close(): void {
      this.readyState = UnreachableFakeWebSocket.CLOSED;
    }
  }

  // Type cast required because: `typeof WebSocket` describes the full DOM constructor, while
  // graphql-ws only ever touches the members implemented above.
  return UnreachableFakeWebSocket as unknown as typeof WebSocket;
};

/** Awaits `n` chained microtask ticks, letting promise-driven library internals settle. */
const flushMicrotasks = (n: number): Promise<void> =>
  n === 0 ? Promise.resolve() : Promise.resolve().then(() => flushMicrotasks(n - 1));

// Type cast required because: the fake server ignores the query text entirely; any syntactically
// valid subscription document satisfies `print()`.
const anySubscription = parse('subscription { events }') as Query.Document<unknown, Record<string, never>>;

describe('WsSubscriptionClient', () => {
  describe('layer', () => {
    // graphql-ws guards its own WebSocket lookup, raising a descriptive "implementation missing"
    // error that tells the caller to pass `webSocketImpl`; the layer must not regress that into an
    // opaque ReferenceError by referencing the global unconditionally.
    it('fails with the descriptive graphql-ws error, not a ReferenceError, when no global WebSocket binding exists', async () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
      // Type cast required because: removing a global binding is the scenario under test, and
      // TypeScript's globalThis type does not model its absence.
      delete (globalThis as { WebSocket?: unknown }).WebSocket;
      try {
        const exit = await Effect.gen(function* () {
          return yield* SubscriptionClient.SubscriptionClient;
        }).pipe(
          Effect.provide(WsSubscriptionClient.layer({ url: 'ws://localhost:8088/api/v4/graphql/ws' })),
          Effect.scoped,
          Effect.runPromiseExit,
        );

        expect(Exit.isFailure(exit)).toBe(true);
        const defect = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
        expect(defect).toBeInstanceOf(Error);
        expect(defect).not.toBeInstanceOf(ReferenceError);
        expect((defect as Error).message).toContain('WebSocket implementation missing');
      } finally {
        if (descriptor !== undefined) {
          Object.defineProperty(globalThis, 'WebSocket', descriptor);
        }
      }
    });

    // Disposal must be total: on Node, any timer graphql-ws leaves pending keeps the event loop —
    // and thus a short-lived process — alive after the wallet has fully stopped. The precondition
    // (timers armed while the client is alive, e.g. the keep-alive ping) makes the final
    // assertion non-vacuous without pinning which timers the client uses internally.
    it('leaves no pending timers once the scoped client is disposed', async () => {
      vi.useFakeTimers();
      try {
        const armedWhileAlive = await Effect.gen(function* () {
          const client = yield* SubscriptionClient.SubscriptionClient;
          yield* Stream.runDrain(client.subscribe(anySubscription, {}));
          // Let graphql-ws's post-unsubscribe promise chain settle before sampling.
          yield* Effect.promise(() => flushMicrotasks(20));
          return vi.getTimerCount();
        }).pipe(
          Effect.provide(
            WsSubscriptionClient.layer(
              { url: 'ws://indexer.test/graphql/ws', keepAlive: 15_000 },
              { compression: false, webSocketImpl: makeHandshakeFake() },
            ),
          ),
          Effect.scoped,
          Effect.runPromise,
        );

        // Sanity precondition: the client really had live timers before the scope closed.
        expect(armedWhileAlive).toBeGreaterThan(0);
        // The behavior under test: disposal cancels everything.
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    // The client dials eagerly (lazy: false), and graphql-ws's `dispose()` is async — it awaits
    // the connection promise, which REJECTS when the server is unreachable. Closing the scope
    // while that attempt is in flight must not leak the rejection: a floating rejection crashes
    // Node processes running with --unhandled-rejections=strict and fails any embedder's
    // diagnostics, even though disposal achieved its goal (nothing left to close).
    it('disposes cleanly while the connection attempt is still failing, leaking no rejection', async () => {
      const rejections: unknown[] = [];
      const capture = (reason: unknown): void => {
        rejections.push(reason);
      };
      // Vitest's own listeners would report the captured rejection as a suite-level unhandled
      // error before the assertion runs; detach them for the duration and restore verbatim.
      const priorListeners = process.listeners('unhandledRejection');
      process.removeAllListeners('unhandledRejection');
      process.on('unhandledRejection', capture);
      try {
        await Effect.gen(function* () {
          return yield* SubscriptionClient.SubscriptionClient;
        }).pipe(
          Effect.provide(
            WsSubscriptionClient.layer(
              { url: 'ws://indexer.test/graphql/ws' },
              { compression: false, webSocketImpl: makeUnreachableFake() },
            ),
          ),
          Effect.scoped,
          Effect.runPromise,
        );
        // Give the rejected connection promise time to surface as an unhandledRejection tick.
        await flushMicrotasks(20);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(rejections).toEqual([]);
      } finally {
        process.removeListener('unhandledRejection', capture);
        priorListeners.forEach((listener) => process.on('unhandledRejection', listener));
      }
    });

    // Ensures that we cannot construct a layer for WsSubscriptionClient when we use common incorrect URI schemes.
    it.each(['ftp:', 'mailto:', 'http:', 'https:', 'file:'])(
      'should fail when constructed with %s as the URI scheme',
      async (scheme) => {
        await Effect.gen(function* () {
          // We should never be able to resolve a SubscriptionClient since the configuration used to create the
          // associated WsSubscriptionClient layer is invalid with the protocol schemes being used.
          return yield* SubscriptionClient.SubscriptionClient;
        }).pipe(
          Effect.flatMap((_) => Effect.fail('Unexpectedly resolved a SubscriptionClient')),
          Effect.provide(WsSubscriptionClient.layer({ url: `${scheme}//localhost.com` })),
          // Ensure the reported invalid protocol scheme is the one used.
          Effect.catchTag('InvalidProtocolSchemeError', (err) =>
            err.invalidScheme !== scheme
              ? Effect.fail(`Expected '${scheme}' but received '${err.invalidScheme}'`)
              : Effect.succeed(void 0),
          ),
          Effect.scoped,
          Effect.runPromise,
        );
      },
    );
  });
});
