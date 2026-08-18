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
import { Effect, pipe, Scope, Stream } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SerializedTransaction } from '@midnightntwrk/wallet-sdk-abstractions';

const FINALIZED_HASH = '0x9f1c4e2a7b3d5f6081927364a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e';

// `ensureConnection` establishes readiness by making a call rather than reading `isConnected`, so a double for this
// client has to answer it — and answer it faithfully: a probe that succeeded while disconnected would let the
// readiness loop pass without ever connecting.
const faithfulProbe = () =>
  mockApi.isConnected ? Promise.resolve('Midnight Dev') : Promise.reject(new Error('disconnected'));

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
  tx: {
    midnight: {
      sendMnTransaction: vi.fn(),
    },
  },
  rpc: {
    chain: {
      getFinalizedHead: vi.fn(),
      getHeader: vi.fn(),
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
    const client = yield* PolkadotNodeClient.make({ nodeURL: new URL('ws://127.0.0.1:9944') }).pipe(
      Effect.provideService(Scope.Scope, scope),
    );
    return client;
  }).pipe(Effect.runPromise);

/** A submission result whose status is Finalized, in the shape `#handleSubmissionResult` decodes. */
const finalizedResult = {
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
};

describe('PolkadotNodeClient shared connection', () => {
  beforeEach(() => {
    mockApi.isConnected = false;
    mockApi.connect.mockClear();
    mockApi.disconnect.mockClear();
    mockApi.tx.midnight.sendMnTransaction.mockReset();
    mockApi.rpc.chain.getFinalizedHead.mockReset();
    mockApi.rpc.chain.getHeader.mockReset();
    // Restored here rather than inside tests that override it: a test that fails mid-override must not poison the
    // tests after it.
    mockApi.rpc.system.chain.mockImplementation(faithfulProbe);
  });

  it('should keep the connection open under an in-flight submission when getFinalizedBlock finishes first', async () => {
    // Every call on this client ended with an unconditional disconnect of the one shared socket. Interleaving any two
    // calls on the same instance therefore let the first to finish tear the socket down under the other — the case the
    // interface could only warn about. The client must instead track its in-flight calls and disconnect only when the
    // last one finishes.
    const client = await makeClient();
    mockApi.disconnect.mockClear();
    mockApi.connect.mockClear();

    // A submission whose node-side callback is captured and held: the transaction stays in flight — subscription open,
    // no terminal status — until this test finalizes it.
    const submissionArrived = Promise.withResolvers<(result: unknown) => Promise<void>>();
    mockApi.tx.midnight.sendMnTransaction.mockReturnValue({
      send: vi.fn((callback: (result: unknown) => Promise<void>) => {
        submissionArrived.resolve(callback);
        return Promise.resolve(() => {});
      }),
    });
    mockApi.rpc.chain.getFinalizedHead.mockResolvedValue({ toString: () => FINALIZED_HASH });
    mockApi.rpc.chain.getHeader.mockResolvedValue({ number: { toBigInt: () => 1_000n } });

    const submission = pipe(
      client.sendMidnightTransaction(SerializedTransaction.of(new Uint8Array([1, 2, 3]))),
      Stream.runCollect,
      Effect.map((chunk) => [...chunk]),
      Effect.scoped,
      Effect.runPromise,
    );
    const reportSubmissionResult = await submissionArrived.promise;

    // The overlapping read, on the same client instance, completing while the submission is still in flight.
    const block = await Effect.runPromise(client.getFinalizedBlock());
    expect(block.height).toBe(1_000n);

    // The heart of the test: the finished read must not have torn the socket down under the live submission.
    expect(mockApi.disconnect).not.toHaveBeenCalled();
    expect(mockApi.isConnected).toBe(true);

    // Only when the submission — the last in-flight call — finishes does the client release the connection.
    await reportSubmissionResult(finalizedResult);
    const events = await submission;
    expect(events.map((event) => event._tag)).toEqual(['Finalized']);
    expect(mockApi.disconnect).toHaveBeenCalledTimes(1);
  });

  it('should still disconnect after a lone getFinalizedBlock, so counting calls does not leak sockets', async () => {
    const client = await makeClient();
    mockApi.disconnect.mockClear();
    mockApi.rpc.chain.getFinalizedHead.mockResolvedValue({ toString: () => FINALIZED_HASH });
    mockApi.rpc.chain.getHeader.mockResolvedValue({ number: { toBigInt: () => 7n } });

    await Effect.runPromise(client.getFinalizedBlock());

    expect(mockApi.disconnect).toHaveBeenCalledTimes(1);
    expect(mockApi.isConnected).toBe(false);
  });
});
