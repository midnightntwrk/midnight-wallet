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
import { SerializedTransaction } from '@midnightntwrk/wallet-sdk-abstractions';
import BN from 'bn.js';
import { Duration, Effect, Either, Option, Stream, pipe } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as NodeClientError from '../NodeClientError.js';

/*
 * The error tag a failed submission carries is what tells a wallet whether a block may hold the transaction: the
 * wallet releases the coins and Dust a transaction booked only on a tag that proves no block holds it (usurped,
 * invalid, refused, never sent). These tests pin the tag each status the node reports fails with. Finality timing out
 * and a block report the client cannot parse both come after a block held the transaction, so neither may carry a tag
 * that proves exclusion, or the wallet offers coins a block already spent.
 *
 * The client reads each status on its own, without the ones before it, and these tests pin `Invalid` and `Usurped` only
 * as the first answer after the pool took the transaction. They leave open what either should fail with after a block
 * was reported: a fork can retract that block and the pool then mark the transaction invalid while a block on another
 * fork still holds it.
 */

/** The node statuses a submission subscription reports, as `@polkadot/api` exposes them: one flag set at a time. */
type StatusKind =
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
 * One result the node's submission subscription delivers. A block status carries the block's number beside it, as
 * `SubmittableResult` does. `withBlockNumber: false` leaves it out, as `@polkadot/api` does when it cannot read the
 * block's events, or cannot find the transaction among them: it then delivers the status with no block number, which
 * the client cannot decode.
 */
const result = (kind: StatusKind, options: { readonly withBlockNumber?: boolean } = {}) => ({
  status: {
    ...allFlagsOff,
    [kind]: true,
    asInBlock: { toString: () => '0xb10c' },
    asFinalized: { toString: () => '0xb10c' },
  },
  txHash: { toString: () => '0x7a' },
  ...((options.withBlockNumber ?? true) ? { blockNumber: new BN(42) } : {}),
});

type SubmissionResult = ReturnType<typeof result>;

const faithfulProbe = () =>
  mockApi.isConnected ? Promise.resolve('Midnight Dev') : Promise.reject(new Error('disconnected'));

const mockApi = {
  isConnected: false,
  connect: vi.fn(() => {
    mockApi.isConnected = true;
    return Promise.resolve();
  }),
  // As `WsProvider.disconnect()` does: it returns before the socket closes, and the close event follows.
  disconnect: vi.fn(() => {
    setTimeout(() => {
      mockApi.isConnected = false;
      mockApi.emit('disconnected');
    }, 0);
    return Promise.resolve();
  }),
  handlers: {} as Record<string, Array<() => void>>,
  once: vi.fn((event: string, handler: () => void) => {
    (mockApi.handlers[event] ??= []).push(handler);
    return () => {};
  }),
  emit: (event: string) => {
    const handlers = mockApi.handlers[event] ?? [];
    mockApi.handlers[event] = [];
    handlers.forEach((handler) => handler());
  },
  tx: { midnight: { sendMnTransaction: vi.fn() } },
  rpc: { system: { chain: vi.fn(faithfulProbe) } },
  genesisHash: '0x00',
};

vi.mock('@polkadot/api', () => ({
  ApiPromise: {
    create: vi.fn(() => {
      mockApi.isConnected = true;
      return Promise.resolve(mockApi);
    }),
  },
  WsProvider: vi.fn(),
}));

// Imported after vi.mock so the mock is in place.
const { PolkadotNodeClient } = await import('../PolkadotNodeClient.js');

const tx = SerializedTransaction.of(new Uint8Array([1, 2, 3]));

/**
 * A node that answers the submission by delivering `results` to the subscription in order, as `@polkadot/api` does:
 * each on a tick of its own, without waiting for the callback to finish with the one before.
 */
const nodeReporting = (results: ReadonlyArray<SubmissionResult>): void => {
  mockApi.tx.midnight.sendMnTransaction.mockReturnValue({
    send: vi.fn((callback: (delivered: SubmissionResult) => Promise<void>) => {
      results.forEach((delivered) => process.nextTick(() => void callback(delivered)));
      return Promise.resolve(() => {});
    }),
  });
};

/** A node that refuses the submission call itself with `error`, so no subscription starts. */
const nodeRefusingWith = (error: Error): void => {
  mockApi.tx.midnight.sendMnTransaction.mockReturnValue({
    send: vi.fn(() => Promise.reject(error)),
  });
};

/**
 * The events a client's submission stream emitted, then the failure that ended it, if any. The client is closed once
 * the stream ends, as its scope owns the connection. A stream that neither ends nor fails once the node has answered
 * fails the test by name, rather than through the runner's timeout.
 *
 * `onceMade` runs after the client is built and before it submits, to change how the node answers from then on.
 */
const submissionOutcome = async (options: { readonly onceMade?: () => void } = {}) => {
  const outcomes = await pipe(
    PolkadotNodeClient.make({ nodeURL: new URL('ws://127.0.0.1:9944'), reconnectionDelay: Duration.millis(5) }),
    Effect.tap(() => Effect.sync(() => options.onceMade?.())),
    Effect.flatMap((client) => pipe(client.sendMidnightTransaction(tx), Stream.either, Stream.runCollect)),
    Effect.map((chunk) => [...chunk]),
    Effect.timeoutFail({
      duration: Duration.seconds(1),
      onTimeout: () => new Error('the submission stream neither ended nor failed after the node answered'),
    }),
    Effect.scoped,
    Effect.runPromise,
  );
  return {
    events: outcomes.filter(Either.isRight).map((outcome) => outcome.right._tag),
    failure: pipe(
      outcomes.find(Either.isLeft),
      Option.fromNullable,
      Option.map((outcome) => outcome.left),
    ),
  };
};

describe('PolkadotNodeClient submission status', () => {
  beforeEach(() => {
    mockApi.isConnected = false;
    mockApi.handlers = {};
    mockApi.tx.midnight.sendMnTransaction.mockReset();
    mockApi.rpc.system.chain.mockImplementation(faithfulProbe);
  });

  it('should fail with a progress error after reporting the block when finality times out, because a block holds the transaction', async () => {
    nodeReporting([result('isReady'), result('isInBlock'), result('isFinalityTimeout')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted', 'InBlock']);
    expect(Option.getOrThrow(failure)).toMatchObject({ _tag: 'TransactionProgressError', desiredStage: 'Finalized' });
  });

  it('should fail with a dropped error when the pool drops the transaction, because a peer it was broadcast to may still include it', async () => {
    nodeReporting([result('isReady'), result('isBroadcast'), result('isDropped')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted', 'Submitted']);
    expect(Option.getOrThrow(failure)).toBeInstanceOf(NodeClientError.TransactionDroppedError);
  });

  it('should fail with a usurped error when another transaction replaces it, because no block can hold both', async () => {
    nodeReporting([result('isReady'), result('isUsurped')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted']);
    expect(Option.getOrThrow(failure)).toBeInstanceOf(NodeClientError.TransactionUsurpedError);
  });

  it('should fail with an invalid error when the pool reports the transaction invalid, because the pool discarded it', async () => {
    nodeReporting([result('isReady'), result('isInvalid')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted']);
    expect(Option.getOrThrow(failure)).toBeInstanceOf(NodeClientError.TransactionInvalidError);
  });

  it('should fail with a parse error when an in-block report has no block number, because the report still says a block holds it', async () => {
    // Finality follows, so a client that skipped the unparsable report would end the stream rather than fail it.
    nodeReporting([result('isReady'), result('isInBlock', { withBlockNumber: false }), result('isFinalized')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted']);
    expect(Option.getOrThrow(failure)).toBeInstanceOf(NodeClientError.ParseError);
  });

  it('should fail with a parse error after reporting the block when the finalized report has no block number, because a block holds the transaction', async () => {
    nodeReporting([result('isReady'), result('isInBlock'), result('isFinalized', { withBlockNumber: false })]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted', 'InBlock']);
    expect(Option.getOrThrow(failure)).toBeInstanceOf(NodeClientError.ParseError);
  });

  it('should end without a failure once the transaction is finalized, because the submission succeeded', async () => {
    nodeReporting([result('isReady'), result('isInBlock'), result('isFinalized')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted', 'InBlock', 'Finalized']);
    expect(Option.isNone(failure)).toBe(true);
  });

  it('should report a transaction whose block was retracted as submitted again and follow it to finality, because the next block may include it', async () => {
    nodeReporting([
      result('isReady'),
      result('isInBlock'),
      result('isRetracted'),
      result('isInBlock'),
      result('isFinalized'),
    ]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted', 'InBlock', 'Submitted', 'InBlock', 'Finalized']);
    expect(Option.isNone(failure)).toBe(true);
  });

  it('should fail with a progress error when finality times out on the block that included it after a retraction, because that block holds the transaction', async () => {
    nodeReporting([
      result('isReady'),
      result('isInBlock'),
      result('isRetracted'),
      result('isInBlock'),
      result('isFinalityTimeout'),
    ]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted', 'InBlock', 'Submitted', 'InBlock']);
    expect(Option.getOrThrow(failure)).toMatchObject({ _tag: 'TransactionProgressError', desiredStage: 'Finalized' });
  });

  it('should report a transaction in the pool’s future queue as submitted and follow it to finality, because the pool still holds it', async () => {
    nodeReporting([result('isFuture'), result('isReady'), result('isInBlock'), result('isFinalized')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted', 'Submitted', 'InBlock', 'Finalized']);
    expect(Option.isNone(failure)).toBe(true);
  });

  it('should fail with a connection error without sending when the node answers the socket but not its calls, because no block can hold a transaction never sent', async () => {
    nodeReporting([result('isReady'), result('isInBlock'), result('isFinalized')]);

    const { events, failure } = await submissionOutcome({
      onceMade: () => {
        mockApi.isConnected = true;
        mockApi.rpc.system.chain.mockImplementation(() => Promise.reject(new Error('RPC broken')));
      },
    });

    expect(events).toStrictEqual([]);
    expect(Option.getOrThrow(failure)).toBeInstanceOf(NodeClientError.ConnectionError);
    expect(mockApi.tx.midnight.sendMnTransaction).not.toHaveBeenCalled();
  });

  it('should fail with a submission error carrying the node’s answer when the node refuses the call, because its code says whether the pool ever took the transaction', async () => {
    const answer = Object.assign(new Error('1010: Invalid Transaction'), { code: 1010 });
    nodeRefusingWith(answer);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual([]);
    const error = Option.getOrThrow(failure);
    expect(error).toBeInstanceOf(NodeClientError.SubmissionError);
    expect(error).toMatchObject({ cause: answer });
  });
});
