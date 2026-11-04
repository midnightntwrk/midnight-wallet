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
import { EventEmitter } from 'node:events';
import { describe, it, vi, expect, beforeEach } from 'vitest';
import { Cause, Duration, Effect, Exit, Fiber, Option, Schedule } from 'effect';

/** How long the fake's socket takes to close after `disconnect()`. */
const CLOSE_LATENCY_MILLIS = 5;

type SocketState = 'closed' | 'connecting' | 'open' | 'closing';

const socket: { state: SocketState; failedRequests: readonly string[] } = {
  state: 'closed',
  failedRequests: [],
};

/**
 * An api double whose socket opens and closes the way `WsProvider`'s does.
 *
 * @remarks
 *   `connect()` resolves as soon as the WebSocket is constructed and leaves the socket connecting until the test
 *   completes the handshake with {@link completeHandshake}; only then does `isConnected` turn true and `connected` fire.
 *   `isConnected` stays true while the socket is closing, because the provider clears it only when the close event
 *   fires. A request on a socket that is not open fails, and polkadot.js logs every failed request at error level, so
 *   `socket.failedRequests` records what a consumer would have seen printed. The provider rejects a request on a
 *   connecting socket at once and one on a closing socket when the close lands; the fake rejects both at once, which
 *   fails the same requests. A `connect()` while a socket already exists is rejected, as the provider rejects it.
 */
const fakeApi = {
  events: new EventEmitter(),
  get isConnected(): boolean {
    return socket.state === 'open' || socket.state === 'closing';
  },
  connect: () => {
    if (socket.state !== 'closed') {
      return Promise.reject(new Error('WebSocket is already connected'));
    }
    socket.state = 'connecting';
    return Promise.resolve();
  },
  disconnect: () => {
    if (socket.state === 'open') {
      socket.state = 'closing';
      setTimeout(() => {
        socket.state = 'closed';
        fakeApi.events.emit('disconnected');
      }, CLOSE_LATENCY_MILLIS);
    }
    return Promise.resolve();
  },
  on: (type: string, handler: () => void) => {
    fakeApi.events.on(type, handler);
    return fakeApi;
  },
  once: (type: string, handler: () => void) => {
    fakeApi.events.once(type, handler);
    return fakeApi;
  },
  off: (type: string, handler: () => void) => {
    fakeApi.events.off(type, handler);
    return fakeApi;
  },
  send: <A>(method: string, answer: A): Promise<A> => {
    if (socket.state !== 'open') {
      socket.failedRequests = [...socket.failedRequests, method];
      return Promise.reject(new Error(`WebSocket is not connected\nFailed WS Request: {"method":"${method}"}`));
    }
    return Promise.resolve(answer);
  },
  rpc: {
    system: {
      chain: () => fakeApi.send('system_chain', 'Midnight Dev'),
    },
    chain: {
      getFinalizedHead: () => fakeApi.send('chain_getFinalizedHead', { toString: () => `0x${'ab'.repeat(32)}` }),
      getHeader: () => fakeApi.send('chain_getHeader', { number: { toBigInt: () => 7n } }),
    },
  },
  genesisHash: `0x${'00'.repeat(32)}`,
};

/** Completes the handshake of the connecting socket — the network's doing, not the client's. */
const completeHandshake = (): void => {
  socket.state = 'open';
  fakeApi.events.emit('connected');
};

/** Waits until the client has driven the fake's socket into `state`. */
const untilSocketIs = (state: SocketState) =>
  Effect.sync(() => socket.state).pipe(
    Effect.repeat({ until: (current) => current === state, schedule: Schedule.spaced(Duration.millis(1)) }),
  );

vi.mock('@polkadot/api', () => ({
  ApiPromise: {
    // `create` resolves with the socket open and the metadata loaded, which is what `make()` waits for.
    create: () => {
      socket.state = 'open';
      return Promise.resolve(fakeApi);
    },
  },
  WsProvider: class {
    disconnect() {
      return Promise.resolve();
    }
  },
}));

// Must import after vi.mock so the mock is in place
const { PolkadotNodeClient } = await import('../PolkadotNodeClient.js');

describe('PolkadotNodeClient reconnect', () => {
  beforeEach(() => {
    socket.state = 'closed';
    socket.failedRequests = [];
    fakeApi.events.removeAllListeners();
  });

  it('should probe a reconnecting socket only once it has opened, so a call after an idle gap neither fails a request nor waits reconnectionDelay', async () => {
    // A delay no call could sit out inside the test: a probe sent before the socket opens fails, and its retry is
    // scheduled a minute later.
    const reconnectionDelay = Duration.minutes(1);

    const settled = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* PolkadotNodeClient.make({ nodeURL: new URL('ws://127.0.0.1:9944'), reconnectionDelay });
        // `make()` released the socket, so the call below starts from the idle state every later call starts from.
        const fiber = yield* Effect.forkDaemon(client.getFinalizedBlock());
        yield* untilSocketIs('connecting');
        // Held mid-handshake, as a round trip to the node holds it: long enough for a client that probes as soon as
        // `connect()` resolves to have sent that probe.
        yield* Effect.sleep(Duration.millis(50));
        completeHandshake();
        // A bound, not a wait: a call that probes after the open finishes at once, and only one sitting out
        // `reconnectionDelay` reaches it.
        const settled = yield* Fiber.await(fiber).pipe(Effect.timeoutOption(Duration.seconds(1)));
        yield* Fiber.interrupt(fiber);
        return settled;
      }).pipe(Effect.scoped),
    );

    expect(socket.failedRequests).toEqual([]);
    // Compared as a label, so a failure says whether the call was still waiting or failed, and why.
    const outcome = Option.match(settled, {
      onNone: () => 'still waiting',
      onSome: Exit.match({ onSuccess: () => 'succeeded', onFailure: (cause) => Cause.pretty(cause) }),
    });
    expect(outcome).toBe('succeeded');
  });
});
