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
import { Cause, Duration, Effect, Exit, Option, pipe, Scope, Stream } from 'effect';
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
});
