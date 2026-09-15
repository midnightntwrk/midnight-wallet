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
import { Cause, Effect, Exit, Option, Scope } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BLOCK_HASH = '0x9f1c4e2a7b3d5f6081927364a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e';

/** What the RPC answers for a height the node has no block at: a hash of all zeroes, not an error. */
const ABSENT_HASH = `0x${'0'.repeat(64)}`;

/**
 * A stub `ApiPromise`. `ApiPromise.create` is a static factory on an external module, so it cannot be replaced with a
 * hand-written fake object the way an injected service could be.
 */
const mockApi = {
  isConnected: false,
  connect: vi.fn(() => {
    mockApi.isConnected = true;
    return Promise.resolve();
  }),
  disconnect: vi.fn(() => {
    mockApi.isConnected = false;
    mockApi.__emit('disconnected');
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
    handlers.forEach((handler) => handler());
  },
  rpc: {
    chain: {
      getBlockHash: vi.fn(),
    },
    system: {
      // `ensureConnection` establishes readiness by making a call rather than reading `isConnected`, so a double for
      // this client has to answer it.
      chain: vi.fn(() => Promise.resolve('Midnight Dev')),
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

const { PolkadotNodeClient } = await import('../PolkadotNodeClient.js');

const makeClient = () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    return yield* PolkadotNodeClient.make({ nodeURL: new URL('ws://127.0.0.1:9944') }).pipe(
      Effect.provideService(Scope.Scope, scope),
    );
  }).pipe(Effect.runPromise);

describe('PolkadotNodeClient.getBlockHashAt', () => {
  beforeEach(() => {
    mockApi.isConnected = false;
    mockApi.connect.mockClear();
    mockApi.disconnect.mockClear();
    mockApi.rpc.chain.getBlockHash.mockReset();
  });

  it('should report the hash of the block at the requested height', async () => {
    mockApi.rpc.chain.getBlockHash.mockResolvedValue({ toString: () => BLOCK_HASH });
    const client = await makeClient();

    const result = await Effect.runPromise(client.getBlockHashAt(1_000n));

    expect(result).toStrictEqual(Option.some(BLOCK_HASH));
    expect(mockApi.rpc.chain.getBlockHash).toHaveBeenCalledWith(1_000n);
  });

  it('should report no block when the node answers with the all-zero hash, so absence is not read as a real block', async () => {
    // The RPC does not fail for a height the node has nothing at — it answers with a hash of all zeroes. Passing that
    // on as a hash would make every absent block look like a mismatch against a real one.
    mockApi.rpc.chain.getBlockHash.mockResolvedValue({ toString: () => ABSENT_HASH });
    const client = await makeClient();

    const result = await Effect.runPromise(client.getBlockHashAt(9_999_999n));

    expect(result).toStrictEqual(Option.none());
  });

  it('should connect before reading and disconnect afterwards', async () => {
    mockApi.rpc.chain.getBlockHash.mockResolvedValue({ toString: () => BLOCK_HASH });
    const client = await makeClient();
    mockApi.connect.mockClear();
    mockApi.disconnect.mockClear();

    await Effect.runPromise(client.getBlockHashAt(1_000n));

    expect(mockApi.connect).toHaveBeenCalled();
    expect(mockApi.disconnect).toHaveBeenCalled();
  });

  describe('when the node cannot be reached', () => {
    it('should fail with a ConnectionError rather than dying, so callers can handle it', async () => {
      // The liveness check calls this periodically against a node that may be unreachable. That has to be a typed
      // failure the caller can match on, not a defect that tears down the fiber.
      mockApi.rpc.chain.getBlockHash.mockRejectedValue(new Error('websocket closed'));
      const client = await makeClient();

      const exit = await Effect.runPromiseExit(client.getBlockHashAt(1_000n));

      expect(Exit.isFailure(exit)).toBe(true);
      const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.isSome(failure)).toBe(true);
      expect(Option.getOrThrow(failure)._tag).toBe('ConnectionError');
    });

    it('should still disconnect when the read fails, so a failed check leaks no connection', async () => {
      mockApi.rpc.chain.getBlockHash.mockRejectedValue(new Error('websocket closed'));
      const client = await makeClient();
      mockApi.disconnect.mockClear();

      await Effect.runPromiseExit(client.getBlockHashAt(1_000n));

      expect(mockApi.disconnect).toHaveBeenCalled();
    });
  });
});
