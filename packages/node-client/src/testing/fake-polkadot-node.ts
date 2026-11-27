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
import BN from 'bn.js';

/** The statuses a node's submission subscription reports, as `@polkadot/api` exposes them: one flag set at a time. */
export type StatusKind =
  | 'isReady'
  | 'isFuture'
  | 'isBroadcast'
  | 'isRetracted'
  | 'isInBlock'
  | 'isFinalized'
  | 'isFinalityTimeout'
  | 'isUsurped'
  | 'isDropped'
  | 'isInvalid';

/** One result a node's submission subscription delivers, in the shape `PolkadotNodeClient` reads from it. */
export type SubmissionResult = {
  readonly status: Readonly<Record<StatusKind, boolean>> & {
    readonly asInBlock: { readonly toString: () => string };
    readonly asFinalized: { readonly toString: () => string };
  };
  readonly txHash: { readonly toString: () => string };
  readonly blockNumber?: BN;
};

const allFlagsOff: Readonly<Record<StatusKind, boolean>> = {
  isReady: false,
  isFuture: false,
  isBroadcast: false,
  isRetracted: false,
  isInBlock: false,
  isFinalized: false,
  isFinalityTimeout: false,
  isUsurped: false,
  isDropped: false,
  isInvalid: false,
};

/**
 * One result a node's submission subscription delivers. A block status carries the block's number beside it, as
 * `SubmittableResult` does. `withBlockNumber: false` leaves it out, as `@polkadot/api` does when it cannot read the
 * block's events, or cannot find the transaction among them: it then delivers the status with no block number, which
 * the client cannot decode.
 *
 * @example
 *   ```typescript
 *   node.reportStatuses([submissionResult('isReady'), submissionResult('isInBlock'), submissionResult('isFinalized')]);
 *   ```;
 *
 * @param kind The status flag that is set.
 * @param options `withBlockNumber: false` leaves the block number out.
 * @returns The result, as the subscription callback receives it.
 */
export const submissionResult = (
  kind: StatusKind,
  options: { readonly withBlockNumber?: boolean } = {},
): SubmissionResult => ({
  status: {
    ...allFlagsOff,
    [kind]: true,
    asInBlock: { toString: () => '0xb10c' },
    asFinalized: { toString: () => '0xb10c' },
  },
  txHash: { toString: () => '0x7a' },
  ...((options.withBlockNumber ?? true) ? { blockNumber: new BN(42) } : {}),
});

/**
 * The part of `ApiPromise` that `PolkadotNodeClient` uses on the way to submitting a transaction. Its socket opens as
 * soon as `connect` is called, so the client never waits on a handshake: `on` and `off` only register and forget the
 * listeners that wait would use.
 */
export type FakeApi = {
  readonly isConnected: boolean;
  readonly genesisHash: string;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly once: (event: string, handler: () => void) => () => void;
  readonly on: (event: string, handler: () => void) => () => void;
  readonly off: (event: string, handler: () => void) => void;
  readonly rpc: { readonly system: { readonly chain: () => Promise<string> } };
  readonly tx: {
    readonly midnight: {
      readonly sendMnTransaction: (hex: string) => {
        readonly send: (callback: (result: SubmissionResult) => Promise<void>) => Promise<() => void>;
      };
    };
  };
};

/** A node that answers the submissions made through a `PolkadotNodeClient` the way a test sets it to. */
export type FakePolkadotNode = {
  /** What `vi.mock('@polkadot/api', …)` must return, so the client builds its api on this node. */
  readonly module: {
    readonly ApiPromise: { readonly create: () => Promise<FakeApi> };
    readonly WsProvider: new () => object;
  };
  /**
   * Answers each submission by delivering `results` in order, each in a macrotask of its own, as separate socket
   * messages reach `@polkadot/api`. Neither waits for the callback to finish, so a handler that awaits a macrotask
   * before emitting could see the next result first.
   */
  readonly reportStatuses: (results: ReadonlyArray<SubmissionResult>) => void;
  /** Answers the submission call itself with `error`, so no subscription starts. */
  readonly refuseSubmission: (error: Error) => void;
  /** Keeps the socket connected but fails every call on it, the readiness probe included. */
  readonly failCalls: () => void;
  /** How many transactions were handed to the node. */
  readonly sentCount: () => number;
  /** Disconnects, cancels deliveries and close events still pending, forgets every answer and listener. */
  readonly reset: () => void;
};

type Answer =
  | { readonly kind: 'statuses'; readonly results: ReadonlyArray<SubmissionResult> }
  | { readonly kind: 'refusal'; readonly error: Error };

type NodeState = {
  connected: boolean;
  callsFail: boolean;
  sent: number;
  answer: Answer;
  readonly handlers: Map<string, ReadonlyArray<() => void>>;
  readonly pending: Set<ReturnType<typeof setTimeout>>;
};

/**
 * Makes a node for `PolkadotNodeClient` to submit to without a network. The node keeps its connection, listeners and
 * answers in one mutable record: a fake socket is state by nature, and the client reads it the way it reads the real
 * `ApiPromise`.
 *
 * A test file that mocks `@polkadot/api` shares one node between the mock and its tests: {@link shared}. `make` builds a
 * further node, e.g. to hand a module of its own to `vi.doMock`.
 *
 * @example
 *   ```typescript
 *   const node = FakePolkadotNode.make();
 *   vi.doMock('@polkadot/api', () => node.module);
 *
 *   const result = FakePolkadotNode.submissionResult;
 *   node.reportStatuses([result('isReady'), result('isInvalid')]);
 *   // import the client after `vi.doMock`, then submit through one built on `new URL('ws://127.0.0.1:9944')`
 *   ```;
 *
 * @returns A fresh node, disconnected and answering calls.
 */
export const make = (): FakePolkadotNode => {
  const state: NodeState = {
    connected: false,
    callsFail: false,
    sent: 0,
    answer: { kind: 'statuses', results: [] },
    handlers: new Map(),
    pending: new Set(),
  };

  // Every delivery and close event goes through here, so `reset` can cancel those a previous test left pending.
  const later = (action: () => void): void => {
    const timer = setTimeout(() => {
      state.pending.delete(timer);
      action();
    }, 0);
    state.pending.add(timer);
  };

  const emit = (event: string): void => {
    const handlers = state.handlers.get(event) ?? [];
    state.handlers.delete(event);
    handlers.forEach((handler) => handler());
  };

  const api: FakeApi = {
    get isConnected() {
      return state.connected;
    },
    genesisHash: '0x00',
    connect: () => {
      state.connected = true;
      return Promise.resolve();
    },
    // As `WsProvider.disconnect()` does: it returns before the socket closes, and the close event follows.
    disconnect: () => {
      later(() => {
        state.connected = false;
        emit('disconnected');
      });
      return Promise.resolve();
    },
    once: (event, handler) => {
      state.handlers.set(event, [...(state.handlers.get(event) ?? []), handler]);
      return () => {};
    },
    on: () => () => {},
    off: () => {},
    rpc: {
      system: {
        // Answers only on a connected socket that is not set to fail, so the client's readiness probe is honest.
        chain: () =>
          state.connected && !state.callsFail
            ? Promise.resolve('Midnight Dev')
            : Promise.reject(new Error(state.callsFail ? 'RPC broken' : 'disconnected')),
      },
    },
    tx: {
      midnight: {
        sendMnTransaction: () => ({
          send: (callback) => {
            const answer = state.answer;
            if (answer.kind === 'refusal') return Promise.reject(answer.error);
            state.sent += 1;
            // Chained, so each result waits for the one before it to be delivered, as messages on one socket do.
            const deliver = (remaining: ReadonlyArray<SubmissionResult>): void => {
              const [next, ...rest] = remaining;
              if (next === undefined) return;
              later(() => {
                void callback(next);
                deliver(rest);
              });
            };
            deliver(answer.results);
            return Promise.resolve(() => {});
          },
        }),
      },
    },
  };

  return {
    module: {
      ApiPromise: {
        create: () => {
          state.connected = true;
          return Promise.resolve(api);
        },
      },
      WsProvider: class {},
    },
    reportStatuses: (results) => {
      state.answer = { kind: 'statuses', results };
    },
    refuseSubmission: (error) => {
      state.answer = { kind: 'refusal', error };
    },
    failCalls: () => {
      state.connected = true;
      state.callsFail = true;
    },
    sentCount: () => state.sent,
    reset: () => {
      state.connected = false;
      state.callsFail = false;
      state.sent = 0;
      state.answer = { kind: 'statuses', results: [] };
      state.handlers.clear();
      state.pending.forEach((timer) => clearTimeout(timer));
      state.pending.clear();
    },
  };
};

/**
 * The node a test file shares between its `vi.mock('@polkadot/api', …)` factory and its tests. Under vitest's default
 * isolation each test file loads its own copy of this module, and so its own node; with `isolate: false` files share
 * it. Its state is one mutable record, so tests that run concurrently within a file (`it.concurrent`) would clash. Call
 * `reset` before each test.
 *
 * @example
 *   ```typescript
 *   vi.mock(
 *     '@polkadot/api',
 *     async () => (await import('@midnightntwrk/wallet-sdk-node-client/testing')).FakePolkadotNode.shared.module,
 *   );
 *   const node = FakePolkadotNode.shared;
 *
 *   beforeEach(() => node.reset());
 *   ```;
 */
export const shared: FakePolkadotNode = make();
