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

/**
 * One record per transaction, from the moment it is balanced to the moment nothing can change its outcome.
 *
 * @remarks
 *   The states, what moves a record between them and what each stores are decided in ADR 0011. Every transition here is
 *   total: an event that does not apply to a record leaves it as it was, so a final state never moves. No transition
 *   frees a coin; each wallet's own sweep does.
 */

import { type ProtocolVersion, type SnapshotFormat } from '@midnightntwrk/wallet-sdk-abstractions';
import { Array as Arr, Data, DateTime, Option, pipe } from 'effect';
import { type FailedTransactionResult } from './pendingTransactions.js';

/**
 * Ids of the coins a transaction spends, per wallet: unshielded coins as `intentHash#outputNo`, shielded coins by
 * nullifier.
 */
export type Inputs = Readonly<{ unshielded: readonly string[]; shielded?: readonly string[] }>;

/** Why a submitted transaction will never be included: the chain refused it, or its TTL passed while it waited. */
export type RejectedVerdict = FailedTransactionResult | Readonly<{ status: 'TTL_PASSED' }>;

/** Where a transaction is in its lifecycle. */
export type LifecycleState = Data.TaggedEnum<{
  Balanced: Record<never, never>;
  Finalized: { readonly finalizedAt: DateTime.Utc };
  Submitted: { readonly submittedAt: DateTime.Utc };
  Confirmed: Record<never, never>;
  Rejected: { readonly verdict: RejectedVerdict };
  Orphaned: {
    readonly authoredFor: ProtocolVersion.ProtocolVersion;
    readonly chainNow: ProtocolVersion.ProtocolVersion;
  };
  Expired: Record<never, never>;
  Reverted: Record<never, never>;
}>;
export const LifecycleState = Data.taggedEnum<LifecycleState>();

/** The record of one transaction. */
export type LifecycleRecord<TTransaction> = Readonly<{
  /** What ties the record to the transaction at every state: proving and binding leave identifiers unchanged. */
  identifiers: readonly string[];
  /** The values the ledger stamps on the coins the transaction creates. */
  intentHashes: readonly string[];
  inputs: Inputs;
  /** From this instant the ledger rejects the transaction. */
  ttl: Date;
  /** The version the transaction's bytes were built for; `none` only for a record that never held its transaction. */
  protocolVersion: Option.Option<ProtocolVersion.ProtocolVersion>;
  /** The transaction in the form for its state; `none` only for a record that never held its transaction. */
  tx: Option.Option<TTransaction>;
  /** When the record began, whichever state it began in. */
  createdAt: DateTime.Utc;
  state: LifecycleState;
}>;

/** Every transaction's record. */
export type TransactionLifecycle<TTransaction> = Readonly<{
  records: ReadonlyArray<LifecycleRecord<TTransaction>>;
  /**
   * The top-level members of the stored payload this build does not declare, exactly as they were read, written back so
   * a later release that wrote them still finds them. Absent when the payload carried none.
   */
  unknownFields?: SnapshotFormat.UnknownFields;
}>;

/** What the facade knows about a transaction when it moves it into a state. */
export type TransactionFacts<TTransaction> = Readonly<{
  tx: TTransaction;
  identifiers: readonly string[];
  intentHashes: readonly string[];
  inputs: Inputs;
  ttl: Date;
  protocolVersion: ProtocolVersion.ProtocolVersion;
}>;

/** No transaction recorded. */
export const empty = <TTransaction>(): TransactionLifecycle<TTransaction> => ({ records: [] });

type StateTag = LifecycleState['_tag'];

/** The states a record can still leave. Every other state is final. */
const LIVE: ReadonlyArray<StateTag> = ['Balanced', 'Finalized', 'Submitted'];

const isLive = <TTransaction>(record: LifecycleRecord<TTransaction>): boolean => LIVE.includes(record.state._tag);

/** A record stands for the same spend as a transaction when they share any identifier. */
const isCoveredBy =
  (identifiers: readonly string[]) =>
  <TTransaction>(record: LifecycleRecord<TTransaction>): boolean =>
    record.identifiers.some((id) => identifiers.includes(id));

const earliest = (times: ReadonlyArray<DateTime.Utc>): Option.Option<DateTime.Utc> =>
  Arr.match(times, { onEmpty: () => Option.none(), onNonEmpty: (all) => Option.some(Arr.min(all, DateTime.Order)) });

/**
 * Moves the live records `facts` covers into `target`, folded into one record that the facts describe.
 *
 * Only live records take part: a final one is never moved, and stays beside the record that replaces the spend. When a
 * live covered record is in a state the move cannot start from, nothing changes. When none is covered, the record
 * begins here.
 */
const moveTo = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  facts: TransactionFacts<TTransaction>,
  from: ReadonlyArray<StateTag>,
  target: LifecycleState,
  createdAt: (folded: ReadonlyArray<LifecycleRecord<TTransaction>>) => DateTime.Utc,
): TransactionLifecycle<TTransaction> => {
  const [rest, covered] = Arr.partition(
    state.records,
    (record) => isLive(record) && isCoveredBy(facts.identifiers)(record),
  );
  return covered.every((record) => from.includes(record.state._tag))
    ? {
        ...state,
        records: Arr.append(rest, {
          identifiers: facts.identifiers,
          intentHashes: facts.intentHashes,
          inputs: facts.inputs,
          ttl: facts.ttl,
          protocolVersion: Option.some(facts.protocolVersion),
          tx: Option.some(facts.tx),
          createdAt: createdAt(covered),
          state: target,
        }),
      }
    : state;
};

/** A record keeps the time it began through every move, and folding several keeps the earliest. */
const keptFrom =
  (now: DateTime.Utc) =>
  <TTransaction>(folded: ReadonlyArray<LifecycleRecord<TTransaction>>): DateTime.Utc =>
    pipe(
      earliest(folded.map((record) => record.createdAt)),
      Option.getOrElse(() => now),
    );

/**
 * Records a transaction as balanced, replacing a balanced record of the same spend: balancing it again begins it anew.
 *
 * @example
 *   const held = balanced(state, { tx: erased, identifiers, intentHashes, inputs, ttl, protocolVersion }, now);
 *
 * @param state The records.
 * @param facts The balanced transaction, with its proofs erased.
 * @param now When it was balanced.
 * @returns The records with the transaction balanced, or unchanged when the spend has already moved past balancing.
 */
export const balanced = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  facts: TransactionFacts<TTransaction>,
  now: DateTime.Utc,
): TransactionLifecycle<TTransaction> => moveTo(state, facts, ['Balanced'], LifecycleState.Balanced(), () => now);

/**
 * Records a transaction as finalized, from balanced or from nothing. Every record the finalized transaction covers is
 * folded into one, because merging the parts of a recipe makes one transaction.
 *
 * @example
 *   const proven = finalized(
 *     state,
 *     { tx: finalizedTx, identifiers, intentHashes, inputs, ttl, protocolVersion },
 *     now,
 *   );
 *
 * @param state The records.
 * @param facts The finalized transaction.
 * @param now When it was finalized.
 * @returns The records with the transaction finalized, or unchanged when the spend has already been submitted.
 */
export const finalized = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  facts: TransactionFacts<TTransaction>,
  now: DateTime.Utc,
): TransactionLifecycle<TTransaction> =>
  moveTo(state, facts, ['Balanced', 'Finalized'], LifecycleState.Finalized({ finalizedAt: now }), keptFrom(now));

/**
 * Records a transaction as submitted, from balanced, finalized or nothing: a transaction proven outside the facade
 * arrives still balanced, and an adopted one arrives unrecorded.
 *
 * @example
 *   const sent = submitted(state, { tx: finalizedTx, identifiers, intentHashes, inputs, ttl, protocolVersion }, now);
 *
 * @param state The records.
 * @param facts The submitted transaction.
 * @param now When it was submitted.
 * @returns The records with the transaction submitted, or unchanged when it already was.
 */
export const submitted = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  facts: TransactionFacts<TTransaction>,
  now: DateTime.Utc,
): TransactionLifecycle<TTransaction> =>
  moveTo(state, facts, ['Balanced', 'Finalized'], LifecycleState.Submitted({ submittedAt: now }), keptFrom(now));
