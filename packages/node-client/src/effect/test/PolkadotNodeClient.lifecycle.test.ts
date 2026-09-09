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
import { describe, it, vi, expect, beforeEach } from 'vitest';
import BN from 'bn.js';
import { Cause, Duration, Effect, Exit, Fiber, Option, pipe, Scope, Stream } from 'effect';
import { SerializedTransaction } from '@midnightntwrk/wallet-sdk-abstractions';

// `ensureConnection` establishes readiness by making a call rather than reading `isConnected`, so a double for this
// client has to answer it — and answer it faithfully: a probe that succeeded while disconnected would let the
// readiness loop pass without ever connecting.
const faithfulProbe = () =>
  mockApi.isConnected ? Promise.resolve('Midnight Dev') : Promise.reject(new Error('disconnected'));

const mockApi = {
  isConnected: false,
  connect: vi.fn(() => {
    mockApi.isConnected = true;
    return Promise.resolve();
  }),
  // WsProvider.disconnect() is fire-and-forget: it returns while the socket is still
  // CLOSING and isConnected only clears once the close event fires.
  disconnect: vi.fn(() => {
    setTimeout(() => {
      mockApi.isConnected = false;
      mockApi.__emit('disconnected');
    }, 5);
    return Promise.resolve();
  }),
  __handlers: {} as Record<string, Array<() => void>>,
  once: vi.fn((event: string, handler: () => void) => {
    (mockApi.__handlers[event] ??= []).push(handler);
    return () => {};
  }),
  __emit: (event: string) => {
    const handlers = mockApi.__handlers[event] ?? [];
    mockApi.__handlers[event] = [];
    handlers.forEach((h) => h());
  },
  tx: {
    midnight: {
      sendMnTransaction: vi.fn(),
    },
  },
  rpc: {
    chain: {
      getBlock: vi.fn(),
    },
    system: {
      chain: vi.fn(faithfulProbe),
    },
  },
  genesisHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
};

vi.mock('@polkadot/api', () => ({
  ApiPromise: {
    create: vi.fn(() => {
      mockApi.isConnected = true;
      return mockApi;
    }),
  },
  WsProvider: vi.fn(),
}));

// Must import after vi.mock so the mock is in place
const { PolkadotNodeClient } = await import('../PolkadotNodeClient.js');

const makeClient = () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const client = yield* PolkadotNodeClient.make({
      nodeURL: new URL('ws://127.0.0.1:9944'),
    }).pipe(Effect.provideService(Scope.Scope, scope));
    return { client, scope };
  }).pipe(Effect.runPromise);

describe('PolkadotNodeClient lifecycle', () => {
  beforeEach(() => {
    mockApi.isConnected = false;
    mockApi.connect.mockClear();
    mockApi.__handlers = {};
    mockApi.disconnect.mockClear();
    mockApi.tx.midnight.sendMnTransaction.mockClear();
    mockApi.rpc.chain.getBlock.mockClear();
    // Restored here rather than inside the tests that override it: a test that fails mid-override must not poison the
    // tests after it.
    mockApi.rpc.system.chain.mockImplementation(faithfulProbe);
  });

  it('getGenesisHash answers from the api without opening a connection', async () => {
    // The genesis hash is fetched once by `ApiPromise.create` and cached on the api, so reading it must not run the
    // ensure-connection dance — the liveness check calls this on every first poll and a wrong-network wallet would
    // otherwise pay a connection round-trip to learn what the client already knows.
    const { client } = await makeClient();
    mockApi.connect.mockClear();
    mockApi.disconnect.mockClear();

    const hash = await Effect.runPromise(client.getGenesisHash());

    expect(hash).toBe(mockApi.genesisHash);
    expect(mockApi.connect).not.toHaveBeenCalled();
    expect(mockApi.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects immediately after make()', async () => {
    const { client } = await makeClient();

    // ApiPromise.create() connects, then make() should disconnect
    expect(mockApi.disconnect).toHaveBeenCalledTimes(1);
    expect(client.api.isConnected).toBe(false);
  });

  it('sendMidnightTransaction connects before and disconnects after', async () => {
    const { client } = await makeClient();
    mockApi.disconnect.mockClear();
    mockApi.connect.mockClear();

    const fakeTx = SerializedTransaction.of(new Uint8Array([1, 2, 3]));

    // Mock sendMnTransaction to return a submittable that calls the callback with Finalized
    mockApi.tx.midnight.sendMnTransaction.mockReturnValue({
      send: vi.fn((callback: (result: unknown) => Promise<void>) => {
        // Simulate async callback invocation after send resolves
        setTimeout(() => {
          void callback({
            status: {
              isReady: false,
              isFuture: false,
              isBroadcast: false,
              isRetracted: false,
              isInBlock: false,
              isFinalized: true,
              asFinalized: { toString: () => '0xabc' },
              isFinalityTimeout: false,
              isUsurped: false,
              isDropped: false,
              isInvalid: false,
            },
            txHash: { toString: () => '0xdef' },
            blockNumber: new BN(42),
          });
        }, 0);
        return Promise.resolve(() => {});
      }),
    });

    const events = await pipe(
      client.sendMidnightTransaction(fakeTx),
      Stream.runCollect,
      Effect.map((chunk) => [...chunk]),
      Effect.scoped,
      Effect.runPromise,
    );

    expect(mockApi.connect).toHaveBeenCalled();
    expect(mockApi.disconnect).toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]._tag).toBe('Finalized');
  });

  it('retries a rejected connect() until it succeeds, rather than dying on it', async () => {
    // `Effect.promise` treated a rejected connect() as a defect: it bypassed the typed ConnectionError mapping and
    // killed the caller's fibre as a crash — while the changeset promises connection failures reach catchTag/catchAll.
    // A rejection is one failed attempt, not a verdict: the readiness loop retries it like any unusable probe.
    const scope = await Effect.runPromise(Scope.make());
    const client = await Effect.runPromise(
      PolkadotNodeClient.make({
        nodeURL: new URL('ws://127.0.0.1:9944'),
        reconnectionDelay: Duration.millis(5),
        reconnectionTimeout: Duration.seconds(5),
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    );
    mockApi.connect.mockClear();
    mockApi.connect
      .mockImplementationOnce(() => Promise.reject(new Error('boom')))
      .mockImplementationOnce(() => {
        mockApi.isConnected = true;
        return Promise.resolve();
      });
    mockApi.rpc.chain.getBlock.mockResolvedValue({ block: { extrinsics: [] } });

    const result = await pipe(client.getGenesis(), Effect.runPromiseExit);

    expect(Exit.isSuccess(result)).toBe(true);
    expect(mockApi.connect).toHaveBeenCalledTimes(2);
  });

  it('surfaces a ConnectionError when the node answers the socket but not RPC, rather than hanging forever', async () => {
    // The readiness probe swallowed every RPC error and retried without limit. Under the default (infinite)
    // reconnectionTimeout — what submission uses — a node whose socket connects but whose RPC persistently fails
    // therefore turned from a loud failure into a silent hang: before the probe existed, `ensureConnection` completed
    // on the socket flag and the first real call failed on the error channel. A connected socket whose probe keeps
    // failing is a verdict about the node, not a connection still on its way up.
    const scope = await Effect.runPromise(Scope.make());
    const client = await Effect.runPromise(
      PolkadotNodeClient.make({
        nodeURL: new URL('ws://127.0.0.1:9944'),
        reconnectionDelay: Duration.millis(5),
        // Deliberately no reconnectionTimeout: the silent hang existed precisely for the unbounded default.
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    );
    mockApi.isConnected = true;
    mockApi.rpc.system.chain.mockImplementation(() => Promise.reject(new Error('RPC broken')));

    const exit = await Effect.runPromiseExit(client.ensureConnection());

    expect(Exit.isFailure(exit)).toBe(true);
    const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
    expect(Option.isSome(failure)).toBe(true);
    expect(Option.getOrThrow(failure)._tag).toBe('ConnectionError');
  });

  it('getGenesis connects before and disconnects after', async () => {
    const { client } = await makeClient();
    mockApi.disconnect.mockClear();
    mockApi.connect.mockClear();

    mockApi.rpc.chain.getBlock.mockResolvedValue({
      block: {
        extrinsics: [],
      },
    });

    const result = await pipe(client.getGenesis(), Effect.runPromise);

    expect(mockApi.connect).toHaveBeenCalled();
    expect(mockApi.disconnect).toHaveBeenCalled();
    expect(result.transactions).toEqual([]);
  });

  it('waits for the socket to actually close when the last call releases it', async () => {
    // `api.disconnect()` returns while the socket is still CLOSING; `isConnected` clears only when the close event
    // fires. A release that does not wait leaves the next call reading a stale `true`: it skips `connect()`, drops its
    // readiness probe on the dying socket, sleeps `reconnectionDelay`, reconnects, and usually fails one more pre-open
    // probe — two seconds or more of a liveness read's ten-second budget. `make()` already waits for the event for this
    // reason; the release path must too.
    const { client } = await makeClient();
    mockApi.rpc.chain.getBlock.mockResolvedValue({ block: { extrinsics: [] } });

    await Effect.runPromise(client.getGenesis());

    expect(client.api.isConnected).toBe(false);
  });

  it('getGenesis surfaces a rejected RPC as a ConnectionError rather than a defect', async () => {
    // A rejection inside `Effect.promise` is a defect: it bypasses the `mapError` that names the failure and any
    // `catchTag('ConnectionError')` in the caller, killing that fibre as a crash. Every other RPC on this client goes
    // through `tryPromise` for exactly that reason; this one must too.
    const { client } = await makeClient();
    mockApi.rpc.chain.getBlock.mockRejectedValue(new Error('node went away mid-request'));

    const exit = await Effect.runPromiseExit(client.getGenesis());

    expect(Exit.isFailure(exit)).toBe(true);
    const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
    expect(Option.isSome(failure)).toBe(true);
    expect(Option.getOrThrow(failure)._tag).toBe('ConnectionError');
  });

  it('does not disconnect a shared connection while another operation is in flight', async () => {
    const { client } = await makeClient();
    mockApi.disconnect.mockClear();
    mockApi.connect.mockClear();

    const fakeTx = SerializedTransaction.of(new Uint8Array([1, 2, 3]));

    // Hold the submission open until the test releases it, so getGenesis has to
    // overlap with it on the same shared api instance.
    let finishSubmission: () => void = () => {};
    mockApi.tx.midnight.sendMnTransaction.mockReturnValue({
      send: vi.fn((callback: (result: unknown) => Promise<void>) => {
        finishSubmission = () => {
          void callback({
            status: {
              isReady: false,
              isFuture: false,
              isBroadcast: false,
              isRetracted: false,
              isInBlock: false,
              isFinalized: true,
              asFinalized: { toString: () => '0xabc' },
              isFinalityTimeout: false,
              isUsurped: false,
              isDropped: false,
              isInvalid: false,
            },
            txHash: { toString: () => '0xdef' },
            blockNumber: new BN(42),
          });
        };
        return Promise.resolve(() => {});
      }),
    });
    mockApi.rpc.chain.getBlock.mockResolvedValue({ block: { extrinsics: [] } });

    const submission = pipe(
      client.sendMidnightTransaction(fakeTx),
      Stream.runCollect,
      Effect.scoped,
      Effect.runPromise,
    );

    // Let the submission acquire the connection before the second operation runs.
    await new Promise((resolve) => setTimeout(resolve, 0));

    await pipe(client.getGenesis(), Effect.runPromise);

    // getGenesis finishing must not close the transport the submission is using.
    expect(mockApi.isConnected).toBe(true);
    expect(mockApi.disconnect).not.toHaveBeenCalled();

    finishSubmission();
    await submission;

    // Only once the last holder finishes does the connection close.
    expect(mockApi.disconnect).toHaveBeenCalledTimes(1);
    // The close itself is asynchronous, mirroring WsProvider.
    await vi.waitFor(() => expect(mockApi.isConnected).toBe(false));
  });

  it('make() waits for the socket to actually close before returning', async () => {
    const { client } = await makeClient();

    // The regression: WsProvider.disconnect() returns while the socket is still CLOSING,
    // so a make() that does not wait leaves isConnected stale-true and ensureConnection()
    // skips the reconnect, sending on a dying socket.
    expect(client.api.isConnected).toBe(false);
  });

  it('make() stops waiting for the close once a finite reconnectionTimeout elapses', async () => {
    // A node that completes the handshake and then goes half-open never acknowledges the close frame. Only ws's own
    // 30-second close timeout ended that wait, from inside an uninterruptible acquire no outer deadline can cut short —
    // so a caller who asked for a 10-second bound waited 40. The bound the caller asked for covers the whole build,
    // the close included.
    //
    // Forked and polled rather than raced: interrupting an uninterruptible acquire would block the test forever.
    mockApi.disconnect.mockImplementationOnce(() => Promise.resolve()); // never emits 'disconnected'

    const settled = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkDaemon(
          Effect.gen(function* () {
            const scope = yield* Scope.make();
            return yield* PolkadotNodeClient.make({
              nodeURL: new URL('ws://127.0.0.1:9944'),
              reconnectionTimeout: Duration.millis(200),
            }).pipe(Effect.provideService(Scope.Scope, scope));
          }),
        );
        yield* Effect.sleep(Duration.seconds(1));
        return yield* Fiber.poll(fiber);
      }).pipe(Effect.scoped),
    );

    expect(Option.isSome(settled)).toBe(true);
  });
});
