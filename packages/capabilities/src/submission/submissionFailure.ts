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
import { type NodeClientError } from '@midnightntwrk/wallet-sdk-node-client/effect';
import { type LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Cause, Data, Option, Predicate, Runtime, pipe } from 'effect';

/** What a failed submission says about whether a block holds the transaction. */
export type SubmissionFailure = Data.TaggedEnum<{
  /**
   * No block holds this send of the transaction. A node refuses a transaction a block already holds the same way, so
   * nothing it booked was spent only if no earlier send of it may be in a block either.
   */
  NotIncluded: Record<never, never>;
  /** A block may hold the transaction, or already does: the failure came after inclusion, or cannot tell. */
  Undetermined: Record<never, never>;
}>;

/**
 * Constructors and matchers for {@link SubmissionFailure}: `NotIncluded` when no block holds the transaction,
 * `Undetermined` when one may.
 *
 * @example
 *   ```typescript
 *   const release = SubmissionFailure.$match(classifySubmissionFailure(rejection), {
 *     NotIncluded: () => true,
 *     Undetermined: () => false,
 *   });
 *   ```;
 */
export const SubmissionFailure = Data.taggedEnum<SubmissionFailure>();

/**
 * The causes that prove no block holds the transaction: the node usurped or invalidated it, no connection was made so
 * it was never sent, or the simulator discarded it. A `LedgerError` on a submission path is always that discard: the
 * simulator fails a submission only when a block producer left the transaction out of every block, since adding to its
 * mempool cannot fail. It carries nothing but its message to tell it apart, so the tag alone is matched.
 *
 * `TransactionDroppedError` is not here. Substrate (`substrate/client/transaction-pool/api/src/lib.rs`) says Dropped
 * means "Transaction has been dropped from the pool because of the limit", and that a transaction "`Dropped` at one
 * point, may later re-enter the pool if some other transactions are removed": a pool drops a broadcast transaction from
 * its own limits, and a peer can still include it.
 */
const EXCLUDING_TAGS = [
  'TransactionUsurpedError',
  'TransactionInvalidError',
  'ConnectionError',
  'LedgerError',
] as const satisfies ReadonlyArray<NodeClientError.NodeClientError['_tag'] | LedgerOps.LedgerError['_tag']>;

/**
 * The author RPC's error codes for a transaction its pool refused outright, so it never entered the pool, from
 * polkadot-sdk `substrate/client/rpc-api/src/author/error.rs`. Codes absent here keep the transaction's fate open:
 * `POOL_TEMPORARILY_BANNED` (1012) was seen recently, perhaps in a block; `POOL_ALREADY_IMPORTED` (1013) is in the
 * pool; `OTHER_ERR` (1040) names no reason.
 */
const POOL_REFUSAL_CODES = {
  BAD_FORMAT: 1001,
  VERIFICATION_ERROR: 1002,
  POOL_INVALID_TX: 1010,
  POOL_UNKNOWN_VALIDITY: 1011,
  POOL_TOO_LOW_PRIORITY: 1014,
  POOL_CYCLE_DETECTED: 1015,
  POOL_IMMEDIATELY_DROPPED: 1016,
  POOL_UNACTIONABLE: 1018,
  POOL_NO_TAGS: 1019,
  POOL_INVALID_BLOCK_ID: 1020,
  POOL_FUTURE_TX: 1021,
} as const;

const refusalCodes: ReadonlyArray<number> = Object.values(POOL_REFUSAL_CODES);

const causeOf = (error: unknown): unknown => (Predicate.hasProperty(error, 'cause') ? error.cause : undefined);

/** Whether a JSON-RPC error carries a refusal code; a socket error's code is a string, and says nothing of the pool. */
const isPoolRefusal = (error: unknown): boolean =>
  Predicate.hasProperty(error, 'code') && Predicate.isNumber(error.code) && refusalCodes.includes(error.code);

/** Whether the node answered the submission call itself with a refusal, rather than failing some later step. */
const nodeRefusedSubmission = (cause: unknown): boolean =>
  Predicate.isTagged(cause, 'SubmissionError') && isPoolRefusal(causeOf(cause));

const provesExclusion = (cause: unknown): boolean =>
  EXCLUDING_TAGS.some((tag) => Predicate.isTagged(cause, tag)) || nodeRefusedSubmission(cause);

/**
 * The `SubmissionError` a submission service rejected with, bare or unwrapped from the fiber that failed with it.
 * Matched by tag, because another installed copy of this package has its own class.
 */
const submissionErrorOf = (rejection: unknown): Option.Option<{ readonly _tag: 'SubmissionError' }> =>
  pipe(
    Runtime.isFiberFailure(rejection)
      ? Cause.failureOption(rejection[Runtime.FiberFailureCauseId])
      : Option.some(rejection),
    Option.filter(Predicate.isTagged('SubmissionError')),
  );

/**
 * Reads what a rejected submission says about the transaction's inclusion. It accepts a `SubmissionError`, matched by
 * its tag, either bare or inside the `FiberFailure` that `Effect.runPromise` rejects with; any other rejection is
 * `Undetermined`. Only a cause that proves no block holds the transaction makes it `NotIncluded`.
 *
 * The answer is about the send that was rejected. A caller that sent the transaction before, or may have, still has to
 * know that no earlier send is in a block before it releases anything: a node refuses a transaction it has already
 * applied as it refuses an invalid one.
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
 * @returns `NotIncluded` when the failure proves no block holds the transaction, `Undetermined` otherwise.
 */
export const classifySubmissionFailure = (rejection: unknown): SubmissionFailure =>
  Option.exists(submissionErrorOf(rejection), (error) => provesExclusion(causeOf(error)))
    ? SubmissionFailure.NotIncluded()
    : SubmissionFailure.Undetermined();
