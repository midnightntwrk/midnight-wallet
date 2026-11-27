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
import { FakePolkadotNode } from '@midnightntwrk/wallet-sdk-node-client/testing';
import { NodeClientError } from '@midnightntwrk/wallet-sdk-node-client/effect';
import { Cause, Duration, Effect, Exit, Option, Predicate, Runtime, identity, pipe } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SubmissionFailure } from '../submissionFailure.js';

/*
 * A wallet decides whether to release what a failed submission booked by classifying the default service's rejection.
 * The service wraps whichever failure the node client ended with in a `SubmissionError`, so the classification must
 * come out the same as the node's own report: undetermined whenever a block may hold the transaction, and excluded only
 * on a report the classifier treats as proof that no block does. Whether `Usurped` and `Invalid` should count as that
 * proof is an open question: these tests pin how they are classified today, not that they should be. The wrapped
 * failure is also what an application reads to say why a submission failed, so it must be the node client's own error:
 * its class, and for a refused call the node's own answer as its cause.
 */

// The node the default service's client builds its api on, shared with the tests through node-client's testing entry.
vi.mock(
  '@polkadot/api',
  async () => (await import('@midnightntwrk/wallet-sdk-node-client/testing')).FakePolkadotNode.shared.module,
);

// Imported after vi.mock so the mock is in place.
const { classifySubmissionFailure, makeDefaultSubmissionService } = await import('../index.js');

const node = FakePolkadotNode.shared;
const result = FakePolkadotNode.submissionResult;

/** The submission service reads nothing from a transaction but its bytes, so this stands in for a finalized one. */
const stubTransaction = { serialize: () => new Uint8Array([1, 2, 3]), toString: () => 'stub transaction' };

/**
 * How long a submission may take to settle once the node has answered, before the test fails naming the hang. The
 * default service waits its client's default reconnection delay of 1 s between readiness probes, so a node whose calls
 * fail takes about 2 s to be reported unreachable.
 */
const SETTLE_WITHIN = Duration.seconds(5);

/** The node client's error inside the service's rejection: the `SubmissionError`'s cause. */
const nodeErrorOf = (rejection: unknown): Option.Option<unknown> =>
  pipe(
    Runtime.isFiberFailure(rejection) ? Cause.failureOption(rejection[Runtime.FiberFailureCauseId]) : Option.none(),
    Option.filter(Predicate.isTagged('SubmissionError')),
    Option.flatMap((error) => (Predicate.hasProperty(error, 'cause') ? Option.some(error.cause) : Option.none())),
  );

/**
 * The default service's rejection of a submission awaiting `stage`, exactly as its promise rejects. A submission that
 * neither resolves nor rejects once the node has answered fails the test by name, rather than through the runner's
 * timeout, and the service is closed whichever way the submission ends.
 */
const rejectionOfSubmission = (stage: Stage): Promise<Exit.Exit<unknown, unknown>> => {
  const service = makeDefaultSubmissionService<typeof stubTransaction>({ relayURL: new URL('ws://127.0.0.1:9944') });
  return pipe(
    // `identity` keeps the `FiberFailure` the promise rejects with, which is what a wallet hands the classifier.
    Effect.tryPromise({ try: () => service.submitTransaction(stubTransaction, stage), catch: identity }),
    Effect.flip,
    Effect.timeoutFail({
      duration: SETTLE_WITHIN,
      onTimeout: () => new Error('the submission neither resolved nor rejected after the node answered'),
    }),
    Effect.ensuring(Effect.promise(() => service.close())),
    Effect.runPromiseExit,
  );
};

/** The rejection a submission's exit holds, failing the test when the submission resolved or never settled. */
const rejectionOf = (exit: Exit.Exit<unknown, unknown>): Promise<unknown> =>
  Exit.isSuccess(exit)
    ? Promise.resolve(exit.value)
    : Promise.reject(new Error(`the submission did not reject: ${Cause.pretty(exit.cause)}`));

/** Any of the node client's error classes. */
type NodeClientErrorClass = (typeof NodeClientError)[keyof typeof NodeClientError];

/** The stages a caller can wait for: the default service's own default, and the one the facade waits for. */
type Stage = 'InBlock' | 'Finalized';

/** A node's answer to a submission, and what the service's rejection of it must say. */
type Answer = {
  readonly scenario: string;
  /** The stages the answer can end a submission at: a report of a block ends one waiting for `InBlock` successfully. */
  readonly stages: ReadonlyArray<Stage>;
  readonly answer: () => void;
  readonly classification: SubmissionFailure['_tag'];
  /** The class of the node client's error the rejection wraps. */
  readonly nodeError: NodeClientErrorClass;
};

const socketFailure = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
const poolRefusal = Object.assign(new Error('1010: Invalid'), { code: 1010 });

/** Answers to a submission that leave open whether a block holds the transaction. */
const answersLeavingInclusionOpen: ReadonlyArray<Answer> = [
  {
    scenario: 'finality timed out on the block that included it',
    stages: ['Finalized'],
    answer: () => node.reportStatuses([result('isReady'), result('isInBlock'), result('isFinalityTimeout')]),
    classification: 'Undetermined',
    nodeError: NodeClientError.TransactionProgressError,
  },
  {
    scenario: 'the finalized report could not be parsed',
    stages: ['Finalized'],
    answer: () =>
      node.reportStatuses([result('isReady'), result('isInBlock'), result('isFinalized', { withBlockNumber: false })]),
    classification: 'Undetermined',
    nodeError: NodeClientError.ParseError,
  },
  {
    scenario: 'the pool dropped it after broadcasting it',
    stages: ['InBlock', 'Finalized'],
    answer: () => node.reportStatuses([result('isReady'), result('isBroadcast'), result('isDropped')]),
    classification: 'Undetermined',
    nodeError: NodeClientError.TransactionDroppedError,
  },
  {
    scenario: 'the socket failed during the call',
    stages: ['InBlock', 'Finalized'],
    answer: () => node.refuseSubmission(socketFailure),
    classification: 'Undetermined',
    nodeError: NodeClientError.SubmissionError,
  },
  {
    scenario: 'the subscription ended without reporting a block',
    stages: ['InBlock'],
    answer: () => node.reportStatuses([result('isReady'), result('isFinalized')]),
    classification: 'Undetermined',
    nodeError: NodeClientError.TransactionProgressError,
  },
];

/** Answers to a submission that the classifier treats as proof that no block holds the transaction, today. */
const answersProvingExclusion: ReadonlyArray<Answer> = [
  {
    scenario: 'the pool refused it outright',
    stages: ['InBlock', 'Finalized'],
    answer: () => node.refuseSubmission(poolRefusal),
    classification: 'NotIncluded',
    nodeError: NodeClientError.SubmissionError,
  },
  {
    scenario: 'another transaction usurped it',
    stages: ['InBlock', 'Finalized'],
    answer: () => node.reportStatuses([result('isReady'), result('isUsurped')]),
    classification: 'NotIncluded',
    nodeError: NodeClientError.TransactionUsurpedError,
  },
  {
    scenario: 'the pool reported it invalid',
    stages: ['InBlock', 'Finalized'],
    answer: () => node.reportStatuses([result('isReady'), result('isInvalid')]),
    classification: 'NotIncluded',
    nodeError: NodeClientError.TransactionInvalidError,
  },
  {
    scenario: 'the node answered the socket but not its calls, so nothing was sent',
    stages: ['InBlock', 'Finalized'],
    answer: () => node.failCalls(),
    classification: 'NotIncluded',
    nodeError: NodeClientError.ConnectionError,
  },
];

/** One case per answer and per stage it can end a submission at. */
const perStage = (answers: ReadonlyArray<Answer>) =>
  answers.flatMap((answer) => answer.stages.map((stage) => ({ ...answer, stage })));

describe('Classifying the default submission service’s rejection', () => {
  beforeEach(() => node.reset());

  it.each(perStage(answersLeavingInclusionOpen))(
    'should be undetermined when waiting for $stage and $scenario, because the service wraps the node client’s own error, which leaves open whether a block holds it',
    async ({ stage, answer, classification, nodeError }) => {
      answer();

      const rejection = await rejectionOf(await rejectionOfSubmission(stage));

      expect(classifySubmissionFailure(rejection)._tag).toBe(classification);
      expect(Option.getOrThrow(nodeErrorOf(rejection))).toBeInstanceOf(nodeError);
    },
  );

  it.each(perStage(answersProvingExclusion))(
    'should be classified as excluding when waiting for $stage and $scenario, because the service wraps the node client’s own error, which the classifier treats as proof',
    async ({ stage, answer, classification, nodeError }) => {
      answer();

      const rejection = await rejectionOf(await rejectionOfSubmission(stage));

      expect(classifySubmissionFailure(rejection)._tag).toBe(classification);
      expect(Option.getOrThrow(nodeErrorOf(rejection))).toBeInstanceOf(nodeError);
    },
  );

  it.each([
    ['the socket failed during the call', socketFailure],
    ['the pool refused it outright', poolRefusal],
  ])(
    'should keep the node’s own answer inside the wrapped error when %s, because its code says whether the pool ever took the transaction',
    async (_, nodeAnswer) => {
      node.refuseSubmission(nodeAnswer);

      const rejection = await rejectionOf(await rejectionOfSubmission('Finalized'));

      const wrapped = Option.getOrThrow(nodeErrorOf(rejection));
      expect(Predicate.hasProperty(wrapped, 'cause') ? wrapped.cause : undefined).toBe(nodeAnswer);
    },
  );
});
