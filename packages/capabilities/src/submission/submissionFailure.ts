/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Cause, Data, Option, Predicate, Runtime, pipe } from 'effect';
import { SubmissionError } from './submissionService.js';

/** What a failed submission says about whether a block holds the transaction. */
export type SubmissionFailure = Data.TaggedEnum<{
  /** No block holds the transaction, so nothing it booked was spent. */
  NotIncluded: Record<never, never>;
  /** A block may hold the transaction, or already does: the failure came after inclusion, or cannot tell. */
  Undetermined: Record<never, never>;
}>;
export const SubmissionFailure = Data.taggedEnum<SubmissionFailure>();

/**
 * The causes that prove no block holds the transaction: the node usurped, dropped or invalidated it, no connection was
 * made so it was never sent, or the simulator discarded it.
 */
const EXCLUDING_TAGS = [
  'TransactionUsurpedError',
  'TransactionDroppedError',
  'TransactionInvalidError',
  'ConnectionError',
  'LedgerError',
] as const;

/**
 * Whether the node answered the submission call with an error. A JSON-RPC error response carries a numeric `code`; a
 * socket closing mid-call does not, and the node may hold the transaction by then.
 */
const isRpcErrorResponse = (error: unknown): boolean =>
  Predicate.hasProperty(error, 'code') && Predicate.isNumber(error.code);

const provesExclusion = (cause: unknown): boolean =>
  EXCLUDING_TAGS.some((tag) => Predicate.isTagged(cause, tag)) ||
  (Predicate.isTagged(cause, 'SubmissionError') &&
    Predicate.hasProperty(cause, 'cause') &&
    isRpcErrorResponse(cause.cause));

/** The `SubmissionError` a submission service's promise rejected with, unwrapped from the fiber that failed with it. */
const submissionErrorOf = (rejection: unknown): Option.Option<SubmissionError> =>
  Runtime.isFiberFailure(rejection)
    ? pipe(
        Cause.failureOption(rejection[Runtime.FiberFailureCauseId]),
        Option.filter((failure): failure is SubmissionError => failure instanceof SubmissionError),
      )
    : Option.none();

/**
 * Reads what a rejected submission says about the transaction's inclusion. Only a failure that proves no block holds
 * the transaction is `NotIncluded`; one raised after inclusion, one that cannot tell, and any rejection that is not a
 * submission service's own are `Undetermined`.
 *
 * @example
 *   ```typescript
 *   await submission.submitTransaction(tx, 'Finalized').catch((rejection: unknown) =>
 *     SubmissionFailure.$match(classifySubmissionFailure(rejection), {
 *       NotIncluded: () => release(tx),
 *       Undetermined: () => undefined,
 *     }),
 *   );
 *   ```;
 *
 * @param rejection What the submission service's promise rejected with.
 * @returns Whether the failure proves the transaction is in no block.
 */
export const classifySubmissionFailure = (rejection: unknown): SubmissionFailure =>
  pipe(
    submissionErrorOf(rejection),
    Option.filter((error) => provesExclusion(error.cause)),
    Option.match({
      onNone: () => SubmissionFailure.Undetermined(),
      onSome: () => SubmissionFailure.NotIncluded(),
    }),
  );
