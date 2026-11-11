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
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, SerializedTransaction } from '@midnightntwrk/wallet-sdk-abstractions';
import { NodeClientError } from '@midnightntwrk/wallet-sdk-node-client/effect';
import { LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Data, Effect, Runtime } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { Simulator } from '../../simulation/v9/index.js';

/**
 * A node that accepts nothing: `ApiPromise.create` waits indefinitely, so the default service's client build is still
 * running when the service is closed, and no socket is opened.
 */
vi.mock('@polkadot/api', () => ({
  ApiPromise: { create: vi.fn(() => new Promise(() => {})) },
  WsProvider: class {
    disconnect(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

const { SubmissionError, classifySubmissionFailure, makeDefaultSubmissionService, makeV9SimulatorSubmissionService } =
  await import('../index.js');

/** A tagged failure from some other service, which says nothing about a submission. */
class UnrelatedFailure extends Data.TaggedError('UnrelatedFailure')<{ readonly cause: unknown }> {}

/** The bytes a node error names as the transaction it is about; no test reads them. */
const txData = SerializedTransaction.of(new Uint8Array([1, 2, 3]));

/** What the promise boundary hands a caller when a submission service built on Effect fails with `cause`. */
const fiberRejection = (cause: unknown): Promise<unknown> =>
  Effect.runPromise(Effect.fail(new SubmissionError({ message: 'Transaction submission error', cause }))).then(
    () => expect.unreachable('a failing effect resolved'),
    (rejection: unknown) => rejection,
  );

/**
 * A JSON-RPC error answer as the polkadot client raises it: an `Error` carrying the numeric code the node sent, as
 * `@polkadot/rpc-provider`'s `RpcError` does.
 */
const rpcError = (code: number): Error => Object.assign(new Error(`${code}: node answer`), { code });

/** The node client's failure when the node answered the submission call with `cause`. */
const nodeAnswered = (cause: unknown) =>
  new NodeClientError.SubmissionError({ message: 'Transaction submission failed', txData, cause });

/**
 * Codes the node's author RPC answers with when its pool refused the transaction outright, so it never entered the pool
 * (polkadot-sdk `substrate/client/rpc-api/src/author/error.rs`).
 */
const refusalCodes: ReadonlyArray<readonly [string, number]> = [
  ['BAD_FORMAT', 1001],
  ['VERIFICATION_ERROR', 1002],
  ['POOL_INVALID_TX', 1010],
  ['POOL_UNKNOWN_VALIDITY', 1011],
  ['POOL_TOO_LOW_PRIORITY', 1014],
  ['POOL_CYCLE_DETECTED', 1015],
  ['POOL_IMMEDIATELY_DROPPED', 1016],
  ['POOL_UNACTIONABLE', 1018],
  ['POOL_NO_TAGS', 1019],
  ['POOL_INVALID_BLOCK_ID', 1020],
  ['POOL_FUTURE_TX', 1021],
];

/** Codes that leave the transaction in the pool or a block, or say nothing about where it is. */
const nonRefusalCodes: ReadonlyArray<readonly [string, number]> = [
  ['POOL_TEMPORARILY_BANNED, a transaction recently seen, perhaps in a block', 1012],
  ['POOL_ALREADY_IMPORTED, a transaction the pool already holds', 1013],
  ['OTHER_ERR, which names no reason', 1040],
  ['a code the author RPC does not define', 4242],
];

/** Causes that prove no block holds the transaction. */
const excludingCauses: ReadonlyArray<readonly [string, unknown]> = [
  ['the node reported it usurped', new NodeClientError.TransactionUsurpedError({ message: 'usurped', txData })],
  ['the node reported it invalid', new NodeClientError.TransactionInvalidError({ message: 'invalid', txData })],
  ['no connection to the node was made', new NodeClientError.ConnectionError({ message: 'Could not connect' })],
  ['the simulator discarded it', new LedgerOps.LedgerError({ message: 'Transaction was discarded' })],
];

/** Causes that leave open whether a block holds the transaction. */
const nonExcludingCauses: ReadonlyArray<readonly [string, unknown]> = [
  [
    // A pool's limits drop a transaction locally after it was broadcast; a peer can still put it in a block.
    'the node reported it dropped from its own pool',
    new NodeClientError.TransactionDroppedError({ message: 'dropped', txData }),
  ],
  [
    'finality timed out',
    new NodeClientError.TransactionProgressError({ message: 'timed out', txData, desiredStage: 'Finalized' }),
  ],
  [
    'the socket failed with a non-numeric code',
    nodeAnswered(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })),
  ],
  // A numeric code proves a refusal only as the node's answer to the submission call.
  ['a cause other than the node client’s submission failure carries a refusal code', rpcError(1010)],
];

describe('Classifying a rejected submission', () => {
  it.each(excludingCauses)('should prove exclusion when %s, because no block can hold it', async (_, cause) => {
    expect(classifySubmissionFailure(await fiberRejection(cause))._tag).toBe('NotIncluded');
  });

  it.each(nonExcludingCauses)(
    'should not prove exclusion when %s, because a block may hold the transaction',
    async (_, cause) => {
      expect(classifySubmissionFailure(await fiberRejection(cause))._tag).toBe('Undetermined');
    },
  );

  it.each(refusalCodes)(
    'should prove exclusion when the node answers %s (%i), because its pool refused the transaction',
    async (_, code) => {
      expect(classifySubmissionFailure(await fiberRejection(nodeAnswered(rpcError(code))))._tag).toBe('NotIncluded');
    },
  );

  it.each(nonRefusalCodes)(
    'should not prove exclusion when the node answers %s (%i), because the pool or a block may hold the transaction',
    async (_, code) => {
      expect(classifySubmissionFailure(await fiberRejection(nodeAnswered(rpcError(code))))._tag).toBe('Undetermined');
    },
  );

  it('should not prove exclusion for a fiber failure that is not a submission error, because nothing says it was refused', async () => {
    const rejection = await Effect.runPromise(
      Effect.fail(new NodeClientError.ConnectionError({ message: 'Could not connect' })),
    ).catch((error: unknown) => error);

    expect(classifySubmissionFailure(rejection)._tag).toBe('Undetermined');
  });

  it.each<readonly [string, () => Promise<unknown>]>([
    [
      'a plain error',
      () =>
        Promise.resolve(
          new Error('wrapped', {
            cause: new NodeClientError.TransactionUsurpedError({ message: 'usurped', txData }),
          }),
        ),
    ],
    [
      'a fiber failure with another tagged error',
      () =>
        Effect.runPromise(
          Effect.fail(
            new UnrelatedFailure({
              cause: new NodeClientError.TransactionUsurpedError({ message: 'usurped', txData }),
            }),
          ),
        ).catch((error: unknown) => error),
    ],
  ])(
    'should not prove exclusion when %s wraps an excluding cause, because only the submission error says the node was the one answering',
    async (_, makeRejection) => {
      expect(classifySubmissionFailure(await makeRejection())._tag).toBe('Undetermined');
    },
  );

  it('should classify a bare submission error as it does one inside a fiber failure, because both carry the same cause', () => {
    const bare = new SubmissionError({
      message: 'Transaction submission error',
      cause: new NodeClientError.TransactionInvalidError({ message: 'invalid', txData }),
    });

    expect(classifySubmissionFailure(bare)._tag).toBe('NotIncluded');
  });

  it('should recognise a submission error from another copy of the package by its tag, because the class differs per copy', async () => {
    class SubmissionErrorOfAnotherCopy extends Data.TaggedError('SubmissionError')<{
      message: string;
      cause?: unknown;
    }> {}
    const cause = new NodeClientError.TransactionUsurpedError({ message: 'usurped', txData });

    const fromAnotherCopy = await Effect.runPromise(
      Effect.fail(new SubmissionErrorOfAnotherCopy({ message: 'Transaction submission error', cause })),
    ).catch((error: unknown) => error);

    expect(classifySubmissionFailure(fromAnotherCopy)._tag).toBe('NotIncluded');
    expect(classifySubmissionFailure(new SubmissionErrorOfAnotherCopy({ message: 'bare', cause }))._tag).toBe(
      'NotIncluded',
    );
  });

  it('should prove exclusion for the default service submitting after it closed, because it never sent the transaction', async () => {
    const service = makeDefaultSubmissionService<{ serialize: () => Uint8Array }>({
      relayURL: new URL('ws://127.0.0.1:1'),
    });
    await service.close();

    const rejection = await service.submitTransaction({ serialize: () => new Uint8Array() }, 'Finalized').then(
      () => expect.unreachable('a closed service submitted'),
      (error: unknown) => error,
    );

    expect(classifySubmissionFailure(rejection)._tag).toBe('NotIncluded');
  });

  it('should prove exclusion for a transaction the simulator discarded, because no block it produced holds it', () =>
    Effect.gen(function* () {
      const simulator = yield* Simulator.init({});
      const submission = makeV9SimulatorSubmissionService<ledger.ProofErasedTransaction>('InBlock')({
        simulator: {
          submitTransaction: (transaction) => simulator.submitTransaction(transaction),
          getLatestState: () => simulator.getLatestState(),
        },
      });
      // Pays no fee, so a block producer enforcing balancing leaves it out of every block.
      const unbalanced = ledger.Transaction.fromParts(
        NetworkId.NetworkId.Undeployed,
        undefined,
        undefined,
        ledger.Intent.new(new Date(Date.now() + 60_000)),
      ).eraseProofs();

      // Through a promise, as an application calls it, so the rejection is what crosses that boundary.
      const runPromise = Runtime.runPromise(yield* Effect.runtime<never>());
      const rejection = yield* Effect.promise(() =>
        runPromise(submission.submitTransaction(unbalanced)).then(
          () => expect.unreachable('the simulator put an unbalanced transaction in a block'),
          (error: unknown) => error,
        ),
      );

      expect(classifySubmissionFailure(rejection)._tag).toBe('NotIncluded');
    }).pipe(Effect.scoped, Effect.runPromise));
});
