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
import { Effect, pipe, Scope, Stream } from 'effect';
import { SerializedTransaction } from '@midnightntwrk/wallet-sdk-abstractions';

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
});
