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
import { Cause, Option, Predicate, Runtime, pipe } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A wallet decides whether to release what a failed submission booked by classifying the default service's rejection.
 * The service wraps whichever failure the node client ended with in a `SubmissionError`, so the classification must
 * come out the same as the node's own report: undetermined whenever a block may hold the transaction, and excluded only
 * when the node proved no block does. The wrapped failure is also what an application reads to say why a submission
 * failed, so it must be the node client's own error, not another of the same class.
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
 * One result the node's submission subscription delivers, with the block's number a block status carries. Without it,
 * as `@polkadot/api` delivers a status whose block events it could not read, the client cannot decode the report.
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
const { classifySubmissionFailure, makeDefaultSubmissionService } = await import('../index.js');

/** A node that answers the submission by delivering `results` to the subscription, as `@polkadot/api` does. */
const nodeReporting = (results: ReadonlyArray<SubmissionResult>): void => {
  mockApi.tx.midnight.sendMnTransaction.mockReturnValue({
    send: vi.fn((callback: (delivered: SubmissionResult) => Promise<void>) => {
      results.forEach((delivered) => process.nextTick(() => void callback(delivered)));
      return Promise.resolve(() => {});
    }),
  });
};

/** A node that answers the submission call itself with `error`, so no subscription starts. */
const nodeAnsweringWith = (error: Error): void => {
  mockApi.tx.midnight.sendMnTransaction.mockReturnValue({
    send: vi.fn(() => Promise.reject(error)),
  });
};

/** The submission service reads nothing from a transaction but its bytes, so this stands in for a finalized one. */
const stubTransaction = { serialize: () => new Uint8Array([1, 2, 3]), toString: () => 'stub transaction' };

/** The tag of the node client's error inside the service's rejection: the `SubmissionError`'s cause. */
const nodeErrorTagOf = (rejection: unknown): string =>
  pipe(
    Runtime.isFiberFailure(rejection) ? Cause.failureOption(rejection[Runtime.FiberFailureCauseId]) : Option.none(),
    Option.filter(Predicate.isTagged('SubmissionError')),
    Option.flatMap((error) =>
      Predicate.hasProperty(error, 'cause') && Predicate.hasProperty(error.cause, '_tag')
        ? Option.some(String(error.cause._tag))
        : Option.none(),
    ),
    Option.getOrElse(() => 'no node client error inside the rejection'),
  );

/** How long a submission may take to settle once the node has answered, before the test fails naming the hang. */
const SETTLE_WITHIN_MS = 1_000;

/**
 * How a wallet classifies the default service's rejection of a submission awaiting finality, and the node client's
 * error the rejection wraps. A submission that neither resolves nor rejects once the node has answered fails the test
 * by name, rather than through the runner's timeout.
 */
const classifiedRejection = async (): Promise<{ readonly classification: string; readonly nodeError: string }> => {
  const service = makeDefaultSubmissionService<typeof stubTransaction>({ relayURL: new URL('ws://127.0.0.1:9944') });
  const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined };
  try {
    const rejection = await Promise.race([
      service.submitTransaction(stubTransaction, 'Finalized').then(
        () => expect.unreachable('the submission resolved'),
        (error: unknown) => error,
      ),
      new Promise<never>((_, reject) => {
        timer.id = setTimeout(
          () => reject(new Error('the submission neither resolved nor rejected after the node answered')),
          SETTLE_WITHIN_MS,
        );
      }),
    ]);
    return { classification: classifySubmissionFailure(rejection)._tag, nodeError: nodeErrorTagOf(rejection) };
  } finally {
    clearTimeout(timer.id);
    await service.close();
  }
};

/** A node's answer, and the node client's error that answer ends the submission with. */
type Answer = readonly [string, () => void, string];

/** Answers to a submission that leave a block holding the transaction, or may. */
const answersAfterWhichABlockMayHoldIt: ReadonlyArray<Answer> = [
  [
    'finality timed out on the block that holds it',
    () => nodeReporting([result('isReady'), result('isInBlock'), result('isFinalityTimeout')]),
    'TransactionProgressError',
  ],
  [
    'the finalized report could not be parsed',
    () => nodeReporting([result('isReady'), result('isInBlock'), result('isFinalized', { withBlockNumber: false })]),
    'ParseError',
  ],
  [
    'the pool dropped it after broadcasting it',
    () => nodeReporting([result('isReady'), result('isBroadcast'), result('isDropped')]),
    'TransactionDroppedError',
  ],
  [
    'the socket failed during the call',
    () => nodeAnsweringWith(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })),
    'SubmissionError',
  ],
];

/** Answers to a submission that prove no block holds the transaction. */
const answersProvingNoBlockHoldsIt: ReadonlyArray<Answer> = [
  [
    'the pool refused it outright',
    () => nodeAnsweringWith(Object.assign(new Error('1010: Invalid'), { code: 1010 })),
    'SubmissionError',
  ],
  [
    'another transaction usurped it',
    () => nodeReporting([result('isReady'), result('isUsurped')]),
    'TransactionUsurpedError',
  ],
  [
    'the pool reported it invalid',
    () => nodeReporting([result('isReady'), result('isInvalid')]),
    'TransactionInvalidError',
  ],
];

describe('Classifying the default submission service’s rejection', () => {
  beforeEach(() => {
    mockApi.isConnected = false;
    mockApi.handlers = {};
    mockApi.tx.midnight.sendMnTransaction.mockReset();
    mockApi.rpc.system.chain.mockImplementation(faithfulProbe);
  });

  it.each(answersAfterWhichABlockMayHoldIt)(
    'should be undetermined when %s, because the service wraps the node client’s own error, which leaves a block holding it',
    async (_, answer, nodeError) => {
      answer();

      expect(await classifiedRejection()).toStrictEqual({ classification: 'Undetermined', nodeError });
    },
  );

  it.each(answersProvingNoBlockHoldsIt)(
    'should prove exclusion when %s, because the service wraps the node client’s own error, which proves it',
    async (_, answer, nodeError) => {
      answer();

      expect(await classifiedRejection()).toStrictEqual({ classification: 'NotIncluded', nodeError });
    },
  );
});
