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
import { Effect, Layer, Stream, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import * as NodeClient from '../NodeClient.js';
import * as NodeClientError from '../NodeClientError.js';
import * as SubmissionEvent from '../SubmissionEvent.js';

/*
 * A wallet reads the error a submission ends with to tell whether a block may hold the transaction, and releases what
 * the transaction booked only when the error proves no block does. Waiting for a stage must therefore hand on
 * whichever failure ended the client's stream unchanged, and must not turn a stream that ended in a block into a
 * failure that proves exclusion.
 */

const tx = SerializedTransaction.of(new Uint8Array([1, 2, 3]));
const submitted = SubmissionEvent.Submitted({ tx, txHash: '0x7a' });
const inBlock = SubmissionEvent.InBlock({ tx, blockHash: '0xb10c', blockHeight: 42n, txHash: '0x7a' });

/** A node client whose submission stream is `stream`; nothing else is read on the way to submitting. */
const clientSubmittingWith = (
  stream: Stream.Stream<SubmissionEvent.SubmissionEvent, NodeClientError.NodeClientError>,
) =>
  Layer.succeed(NodeClient.NodeClient, {
    sendMidnightTransaction: () => stream,
    getGenesis: () => Effect.die('not used by submission'),
    getFinalizedBlock: () => Effect.die('not used by submission'),
    getBlockHashAt: () => Effect.die('not used by submission'),
    getGenesisHash: () => Effect.die('not used by submission'),
  });

/** What waiting for finality fails with on `stream`. Flipped, so a wait that resolved rejects the test instead. */
const failureAwaitingFinality = (
  stream: Stream.Stream<SubmissionEvent.SubmissionEvent, NodeClientError.NodeClientError>,
) =>
  pipe(
    NodeClient.sendMidnightTransactionAndWait(tx, 'Finalized'),
    Effect.provide(clientSubmittingWith(stream)),
    Effect.flip,
    Effect.runPromise,
  );

/**
 * Every failure a client's submission stream can end with, after the events that can precede it: a failed connection or
 * a refused call ends the stream before the node reports anything.
 */
const streamFailures: ReadonlyArray<
  readonly [string, ReadonlyArray<SubmissionEvent.SubmissionEvent>, NodeClientError.NodeClientError]
> = [
  [
    'finality timed out',
    [submitted, inBlock],
    new NodeClientError.TransactionProgressError({ message: 'timed out', txData: tx, desiredStage: 'Finalized' }),
  ],
  [
    'the finalized report could not be parsed',
    [submitted, inBlock],
    new NodeClientError.ParseError({ message: 'unparseable' }),
  ],
  [
    'the pool dropped the transaction',
    [submitted],
    new NodeClientError.TransactionDroppedError({ message: 'dropped', txData: tx }),
  ],
  [
    'the socket failed during the call',
    [],
    new NodeClientError.SubmissionError({
      message: 'Transaction submission failed',
      txData: tx,
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    }),
  ],
  ['no connection to the node was made', [], new NodeClientError.ConnectionError({ message: 'Could not connect' })],
  [
    'another transaction usurped it',
    [submitted],
    new NodeClientError.TransactionUsurpedError({ message: 'usurped', txData: tx }),
  ],
  [
    'the pool reported it invalid',
    [submitted],
    new NodeClientError.TransactionInvalidError({ message: 'invalid', txData: tx }),
  ],
];

describe('Waiting for a submission stage', () => {
  it('should fail with a progress error when the stream ends in a block without reaching the stage, because a block holds the transaction', async () => {
    const failure = await failureAwaitingFinality(Stream.make(submitted, inBlock));

    expect(failure).toMatchObject({ _tag: 'TransactionProgressError', desiredStage: 'Finalized' });
  });

  it.each(streamFailures)(
    'should fail with the stream’s own error when %s, because the wallet reads that error to tell whether a block may hold the transaction',
    async (_, preceding, error) => {
      const failure = await failureAwaitingFinality(
        pipe(Stream.fromIterable(preceding), Stream.concat(Stream.fail(error))),
      );

      expect(failure).toBe(error);
    },
  );
});
