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
import { Cause, Effect, Exit, Layer, Option, Stream, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import * as NodeClient from '../NodeClient.js';
import * as NodeClientError from '../NodeClientError.js';
import * as SubmissionEvent from '../SubmissionEvent.js';

/*
 * A wallet reads the error a submission ends with to tell whether a block may hold the transaction, and releases what
 * the transaction booked only when the error proves no block does. Waiting for a stage must therefore hand on
 * whichever failure ended the client's stream unchanged, and must not turn a stream that ended early into a failure
 * that proves exclusion, whatever came before the end.
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

/** The stages a caller can wait for. */
type Stage = SubmissionEvent.SubmissionEvent['_tag'];

/** How waiting for `stage` on `stream` ends. */
const awaiting = (
  stage: Stage,
  stream: Stream.Stream<SubmissionEvent.SubmissionEvent, NodeClientError.NodeClientError>,
) =>
  pipe(
    NodeClient.sendMidnightTransactionAndWait(tx, stage),
    Effect.provide(clientSubmittingWith(stream)),
    Effect.runPromiseExit,
  );

/** The failure an exit ended with: none when it succeeded, or when it died rather than failed. */
const failureOf = <A, E>(exit: Exit.Exit<A, E>): Option.Option<E> =>
  Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();

/** A failure a client's submission stream can end with, after the events that can precede it. */
type StreamFailure<Tag extends NodeClientError.NodeClientError['_tag']> = {
  readonly scenario: string;
  readonly preceding: ReadonlyArray<SubmissionEvent.SubmissionEvent>;
  readonly error: Extract<NodeClientError.NodeClientError, { readonly _tag: Tag }>;
};

/**
 * Every failure a client's submission stream can end with, one per tag of the error union, so a new tag does not
 * compile without its case. A failed connection or a refused call ends the stream before the node reports anything.
 */
const streamFailures = {
  TransactionProgressError: {
    scenario: 'finality timed out',
    preceding: [submitted, inBlock],
    error: new NodeClientError.TransactionProgressError({
      message: 'timed out',
      txData: tx,
      desiredStage: 'Finalized',
    }),
  },
  ParseError: {
    scenario: 'the finalized report could not be parsed',
    preceding: [submitted, inBlock],
    error: new NodeClientError.ParseError({ message: 'unparseable' }),
  },
  TransactionDroppedError: {
    scenario: 'the pool dropped the transaction',
    preceding: [submitted],
    error: new NodeClientError.TransactionDroppedError({ message: 'dropped', txData: tx }),
  },
  SubmissionError: {
    scenario: 'the socket failed during the call',
    preceding: [],
    error: new NodeClientError.SubmissionError({
      message: 'Transaction submission failed',
      txData: tx,
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    }),
  },
  ConnectionError: {
    scenario: 'the node never took the call',
    preceding: [],
    error: new NodeClientError.ConnectionError({ message: 'Could not connect' }),
  },
  TransactionUsurpedError: {
    scenario: 'another transaction usurped it',
    preceding: [submitted],
    error: new NodeClientError.TransactionUsurpedError({ message: 'usurped', txData: tx }),
  },
  TransactionInvalidError: {
    scenario: 'the pool reported it invalid',
    preceding: [submitted],
    error: new NodeClientError.TransactionInvalidError({ message: 'invalid', txData: tx }),
  },
} satisfies { readonly [Tag in NodeClientError.NodeClientError['_tag']]: StreamFailure<Tag> };

/** Every history a stream can end early after, for each stage a caller can wait for: none reaches that stage. */
const earlyEnds: ReadonlyArray<readonly [Stage, string, ReadonlyArray<SubmissionEvent.SubmissionEvent>]> = [
  ['Submitted', 'before the node reported anything', []],
  ['InBlock', 'before the node reported anything', []],
  ['InBlock', 'after the pool took the transaction', [submitted]],
  ['Finalized', 'before the node reported anything', []],
  ['Finalized', 'after the pool took the transaction', [submitted]],
  ['Finalized', 'after a block included it', [submitted, inBlock]],
];

/** Every stage a caller can wait for. */
const stages: ReadonlyArray<Stage> = ['Submitted', 'InBlock', 'Finalized'];

describe('Waiting for a submission stage', () => {
  it.each(earlyEnds)(
    'should fail with a progress error when waiting for %s and the stream ends %s, because an early end proves nothing about inclusion',
    async (stage, _, preceding) => {
      const exit = await awaiting(stage, Stream.fromIterable(preceding));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(Option.getOrThrow(failureOf(exit))).toMatchObject({
        _tag: 'TransactionProgressError',
        desiredStage: stage,
      });
    },
  );

  it.each(Object.values(streamFailures))(
    'should fail with the stream’s own error when waiting for finality and $scenario, because the wallet reads that error to tell whether a block may hold the transaction',
    async ({ preceding, error }) => {
      const exit = await awaiting('Finalized', pipe(Stream.fromIterable(preceding), Stream.concat(Stream.fail(error))));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(Option.getOrThrow(failureOf(exit))).toBe(error);
    },
  );

  it.each(
    Object.values(streamFailures).flatMap((failure) =>
      failure.preceding.length === 0 ? [] : [{ stage: 'InBlock' as const, ...failure, preceding: [submitted] }],
    ),
  )(
    'should fail with the stream’s own error when waiting for $stage and $scenario after the pool took the transaction, because what came before must not change the error',
    async ({ stage, preceding, error }) => {
      const exit = await awaiting(stage, pipe(Stream.fromIterable(preceding), Stream.concat(Stream.fail(error))));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(Option.getOrThrow(failureOf(exit))).toBe(error);
    },
  );

  it.each(stages.flatMap((stage) => Object.values(streamFailures).map((failure) => ({ stage, ...failure }))))(
    'should fail with the stream’s own error when waiting for $stage and $scenario before any report, because the stage waited for must not change the error',
    async ({ stage, error }) => {
      const exit = await awaiting(stage, Stream.fail(error));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(Option.getOrThrow(failureOf(exit))).toBe(error);
    },
  );
});
