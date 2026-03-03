import { describe, it, vi, expect, beforeEach } from 'vitest';
import BN from 'bn.js';
import { Effect, pipe, Scope, Stream } from 'effect';
import { SerializedTransaction } from '@midnight-ntwrk/wallet-sdk-abstractions';

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
});
