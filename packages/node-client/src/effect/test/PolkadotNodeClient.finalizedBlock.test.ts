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

const FINALIZED_HASH = '0x9f1c4e2a7b3d5f6081927364a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e';

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
    return Promise.resolve();
  }),
  rpc: {
    chain: {
      getFinalizedHead: vi.fn(),
      getHeader: vi.fn(),
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
    const client = yield* PolkadotNodeClient.make({ nodeURL: new URL('ws://127.0.0.1:9944') }).pipe(
      Effect.provideService(Scope.Scope, scope),
    );
    return client;
  }).pipe(Effect.runPromise);

/** Point the stubbed RPC at a finalized block of the given height. */
const stubFinalizedBlock = (height: bigint) => {
  mockApi.rpc.chain.getFinalizedHead.mockResolvedValue({ toString: () => FINALIZED_HASH });
  mockApi.rpc.chain.getHeader.mockResolvedValue({ number: { toBigInt: () => height } });
};

describe('PolkadotNodeClient.getFinalizedBlock', () => {
  beforeEach(() => {
    mockApi.isConnected = false;
    mockApi.connect.mockClear();
    mockApi.disconnect.mockClear();
    mockApi.rpc.chain.getFinalizedHead.mockReset();
    mockApi.rpc.chain.getHeader.mockReset();
  });

  it('should report the hash and height of the finalized head', async () => {
    stubFinalizedBlock(1_234_567n);
    const client = await makeClient();

    const result = await Effect.runPromise(client.getFinalizedBlock());

    expect(result).toStrictEqual({ hash: FINALIZED_HASH, height: 1_234_567n });
  });

  it('should read the header of the finalized head, not of the best block', async () => {
    // `getHeader` with no argument returns the best block, which may be unfinalized. Passing the finalized hash is what
    // makes the height a finalized one.
    stubFinalizedBlock(42n);
    const client = await makeClient();

    await Effect.runPromise(client.getFinalizedBlock());

    expect(mockApi.rpc.chain.getHeader).toHaveBeenCalledWith(FINALIZED_HASH);
  });

  it('should connect before reading and disconnect afterwards', async () => {
    stubFinalizedBlock(100n);
    const client = await makeClient();
    mockApi.connect.mockClear();
    mockApi.disconnect.mockClear();

    await Effect.runPromise(client.getFinalizedBlock());

    expect(mockApi.connect).toHaveBeenCalled();
    expect(mockApi.disconnect).toHaveBeenCalled();
  });

  describe('when the node cannot be reached', () => {
    it('should fail with a ConnectionError rather than dying, so callers can handle it', async () => {
      // A liveness check runs periodically against a node that may be unreachable. That has to be a typed failure the
      // caller can match on, not a defect that tears down the fiber.
      mockApi.rpc.chain.getFinalizedHead.mockRejectedValue(new Error('websocket closed'));
      const client = await makeClient();

      const exit = await Effect.runPromiseExit(client.getFinalizedBlock());

      expect(Exit.isFailure(exit)).toBe(true);
      const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.isSome(failure)).toBe(true);
      expect(Option.getOrThrow(failure)._tag).toBe('ConnectionError');
    });

    it('should still disconnect when the read fails, so a failed check leaks no connection', async () => {
      mockApi.rpc.chain.getFinalizedHead.mockRejectedValue(new Error('websocket closed'));
      const client = await makeClient();
      mockApi.disconnect.mockClear();

      await Effect.runPromiseExit(client.getFinalizedBlock());

      expect(mockApi.disconnect).toHaveBeenCalled();
    });
  });
});
