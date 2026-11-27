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
import { Duration, Effect, Either, Option, Stream, pipe } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shared as node, submissionResult as result } from '../../testing/fake-polkadot-node.js';
import * as NodeClientError from '../NodeClientError.js';

/*
 * The error tag a failed submission carries is what tells a wallet whether a block may hold the transaction: the
 * wallet releases the coins and Dust a transaction booked only on a tag its classifier treats as proving that no block
 * holds it (today: usurped, invalid, refused, never sent). These tests pin the tag each status the node reports fails
 * with. Finality timing out and a block report the client cannot parse both come after a block held the transaction, so
 * neither may carry a tag that proves exclusion, or the wallet offers coins a block may have spent.
 *
 * The client reads each status on its own, without the ones before it. These tests pin the tag `Invalid` and `Usurped`
 * fail with, and leave open whether either should be treated as proving that no block holds the transaction:
 * - after a block was reported, a fork can retract that block and the pool then mark the transaction invalid while a
 *   block on another fork still holds it;
 * - `Usurped` says this node's pool replaced the transaction with another that provides the same tags, which rules out
 *   both being included, not the original being included by a peer that already had it.
 */

// The node the client builds its api on, shared with the tests through the testing entry's fake.
vi.mock('@polkadot/api', async () => (await import('../../testing/fake-polkadot-node.js')).shared.module);

// Imported after vi.mock so the mock is in place.
const { PolkadotNodeClient } = await import('../PolkadotNodeClient.js');

const tx = SerializedTransaction.of(new Uint8Array([1, 2, 3]));

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
  beforeEach(() => node.reset());

  it('should fail with a progress error after reporting the block when finality times out, because a block may hold the transaction', async () => {
    node.reportStatuses([result('isReady'), result('isInBlock'), result('isFinalityTimeout')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted', 'InBlock']);
    expect(Option.getOrThrow(failure)).toMatchObject({ _tag: 'TransactionProgressError', desiredStage: 'Finalized' });
  });

  it('should fail with a dropped error when the pool drops the transaction, because a peer it was broadcast to may still include it', async () => {
    node.reportStatuses([result('isReady'), result('isBroadcast'), result('isDropped')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted', 'Submitted']);
    expect(Option.getOrThrow(failure)).toBeInstanceOf(NodeClientError.TransactionDroppedError);
  });

  it('should fail with a dropped error when the pool drops the transaction before broadcasting it, because the tag must not depend on what the pool reported first', async () => {
    node.reportStatuses([result('isReady'), result('isDropped')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted']);
    expect(Option.getOrThrow(failure)).toBeInstanceOf(NodeClientError.TransactionDroppedError);
  });

  it('should fail with a usurped error when another transaction replaces it in the pool, because the wallet decides what to release from that tag', async () => {
    node.reportStatuses([result('isReady'), result('isUsurped')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted']);
    expect(Option.getOrThrow(failure)).toBeInstanceOf(NodeClientError.TransactionUsurpedError);
  });

  it('should fail with an invalid error when the pool reports the transaction invalid, because the pool discarded it', async () => {
    node.reportStatuses([result('isReady'), result('isInvalid')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted']);
    expect(Option.getOrThrow(failure)).toBeInstanceOf(NodeClientError.TransactionInvalidError);
  });

  it.each([
    ['a usurped', 'isUsurped', NodeClientError.TransactionUsurpedError],
    ['an invalid', 'isInvalid', NodeClientError.TransactionInvalidError],
  ] as const)(
    'should fail with %s error after the pool broadcast the transaction, because the tag must not depend on what the pool reported first',
    async (_, kind, errorClass) => {
      node.reportStatuses([result('isReady'), result('isBroadcast'), result(kind)]);

      const { events, failure } = await submissionOutcome();

      expect(events).toStrictEqual(['Submitted', 'Submitted']);
      expect(Option.getOrThrow(failure)).toBeInstanceOf(errorClass);
    },
  );

  it('should fail with a parse error when an in-block report has no block number, because the report still says a block may hold it', async () => {
    // Finality follows, so a client that skipped the unparsable report would end the stream rather than fail it.
    node.reportStatuses([result('isReady'), result('isInBlock', { withBlockNumber: false }), result('isFinalized')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted']);
    expect(Option.getOrThrow(failure)).toBeInstanceOf(NodeClientError.ParseError);
  });

  it('should fail with a parse error after reporting the block when the finalized report has no block number, because a block may hold the transaction', async () => {
    node.reportStatuses([result('isReady'), result('isInBlock'), result('isFinalized', { withBlockNumber: false })]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted', 'InBlock']);
    expect(Option.getOrThrow(failure)).toBeInstanceOf(NodeClientError.ParseError);
  });

  it('should end without a failure once the transaction is finalized, because the submission succeeded', async () => {
    node.reportStatuses([result('isReady'), result('isInBlock'), result('isFinalized')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted', 'InBlock', 'Finalized']);
    expect(Option.isNone(failure)).toBe(true);
  });

  it('should report a transaction whose block was retracted as submitted again and follow it to finality, because the next block may include it', async () => {
    node.reportStatuses([
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

  it('should fail with a progress error when finality times out on the block that included it after a retraction, because that block may hold the transaction', async () => {
    node.reportStatuses([
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
    node.reportStatuses([result('isFuture'), result('isReady'), result('isInBlock'), result('isFinalized')]);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual(['Submitted', 'Submitted', 'InBlock', 'Finalized']);
    expect(Option.isNone(failure)).toBe(true);
  });

  it('should fail with a connection error without sending when the node answers the socket but not its calls, because no block can hold a transaction never sent', async () => {
    node.reportStatuses([result('isReady'), result('isInBlock'), result('isFinalized')]);

    const { events, failure } = await submissionOutcome({ onceMade: () => node.failCalls() });

    expect(events).toStrictEqual([]);
    expect(Option.getOrThrow(failure)).toBeInstanceOf(NodeClientError.ConnectionError);
    expect(node.sentCount()).toBe(0);
  });

  it('should fail with a submission error carrying the socket’s error when the socket fails during the call, because a socket failure says nothing about the pool', async () => {
    const socketFailure = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    node.refuseSubmission(socketFailure);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual([]);
    const error = Option.getOrThrow(failure);
    expect(error).toBeInstanceOf(NodeClientError.SubmissionError);
    expect(error).toMatchObject({ cause: socketFailure });
  });

  it('should fail with a submission error carrying the node’s answer when the node refuses the call, because its code says whether the pool ever took the transaction', async () => {
    const answer = Object.assign(new Error('1010: Invalid Transaction'), { code: 1010 });
    node.refuseSubmission(answer);

    const { events, failure } = await submissionOutcome();

    expect(events).toStrictEqual([]);
    const error = Option.getOrThrow(failure);
    expect(error).toBeInstanceOf(NodeClientError.SubmissionError);
    expect(error).toMatchObject({ cause: answer });
  });
});
