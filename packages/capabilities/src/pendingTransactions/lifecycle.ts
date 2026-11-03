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

import { ProtocolVersion, type SnapshotFormat } from '@midnightntwrk/wallet-sdk-abstractions';
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

/** The final states in which the transaction's coins were never spent on chain, so the spend can begin again. */
const ENDED_UNSPENT: ReadonlyArray<StateTag> = ['Rejected', 'Orphaned', 'Expired', 'Reverted'];

const isLive = <TTransaction>(record: LifecycleRecord<TTransaction>): boolean => LIVE.includes(record.state._tag);

/** Moves every record `applies` picks that is in one of the `from` states, leaving every other record as it was. */
const settle = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  applies: (record: LifecycleRecord<TTransaction>) => boolean,
  from: ReadonlyArray<StateTag>,
  to: (record: LifecycleRecord<TTransaction>) => LifecycleState,
): TransactionLifecycle<TTransaction> => ({
  ...state,
  records: state.records.map((record) =>
    applies(record) && from.includes(record.state._tag) ? { ...record, state: to(record) } : record,
  ),
});

/** A record stands for the same spend as a transaction when they share any identifier. */
const isCoveredBy =
  (identifiers: readonly string[]) =>
  <TTransaction>(record: LifecycleRecord<TTransaction>): boolean =>
    record.identifiers.some((id) => identifiers.includes(id));

const earliest = (times: ReadonlyArray<DateTime.Utc>): Option.Option<DateTime.Utc> =>
  Arr.match(times, { onEmpty: () => Option.none(), onNonEmpty: (all) => Option.some(Arr.min(all, DateTime.Order)) });

/**
 * Replaces the records `facts` covers with one record in `target`, which the facts describe.
 *
 * When any covered record is in a state the move cannot start from, nothing changes, so a final state is left alone
 * unless the move names it. When none is covered, the record begins here.
 */
const moveTo = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  facts: TransactionFacts<TTransaction>,
  from: ReadonlyArray<StateTag>,
  target: LifecycleState,
  createdAt: (folded: ReadonlyArray<LifecycleRecord<TTransaction>>) => DateTime.Utc,
): TransactionLifecycle<TTransaction> => {
  const [rest, covered] = Arr.partition(state.records, isCoveredBy(facts.identifiers));
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
 * So does balancing a spend whose record ended without its coins being spent on chain; a confirmed spend stays as it
 * is, and so does one already finalized or submitted.
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
): TransactionLifecycle<TTransaction> =>
  moveTo(state, facts, ['Balanced', ...ENDED_UNSPENT], LifecycleState.Balanced(), () => now);

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

/**
 * Records that a transaction was included, whichever live state its record is in: inclusion is a fact, and nothing
 * overrules it afterwards.
 *
 * @example
 *   const included = confirmed(state, [...tx.identifiers()]);
 *
 * @param state The records.
 * @param identifiers The included transaction's identifiers.
 * @returns The records with the transaction confirmed; a final record is left as it was.
 */
export const confirmed = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  identifiers: readonly string[],
): TransactionLifecycle<TTransaction> =>
  settle(state, isCoveredBy(identifiers), LIVE, () => LifecycleState.Confirmed());

/**
 * Records that the chain refused a submitted transaction. A transaction never submitted is left as it was: no chain was
 * asked to include it.
 *
 * @example
 *   const refused = rejected(state, [...tx.identifiers()], { status: 'FAILURE', segments });
 *
 * @param state The records.
 * @param identifiers The refused transaction's identifiers.
 * @param verdict What the chain reported.
 * @returns The records with the transaction rejected.
 */
export const rejected = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  identifiers: readonly string[],
  verdict: FailedTransactionResult,
): TransactionLifecycle<TTransaction> =>
  settle(state, isCoveredBy(identifiers), ['Submitted'], () => LifecycleState.Rejected({ verdict }));

/** Whether the epoch `authoredFor` belongs to has ended by `chainNow`. A version no epoch serves has not. */
const hasEpochEnded = <TEpoch>(
  epochs: ProtocolVersion.Registry<TEpoch>,
  authoredFor: ProtocolVersion.ProtocolVersion,
  chainNow: ProtocolVersion.ProtocolVersion,
): boolean =>
  pipe(
    ProtocolVersion.selectEntry(epochs, authoredFor),
    Option.exists((entry) => chainNow >= entry.range[1]),
  );

/**
 * Gives up on every live transaction built for an epoch the chain has left. A record whose version was never known is
 * left as it was: that is no evidence it was left behind.
 *
 * @example
 *   const stranded = orphanBeyond(state, traits, chainNow);
 *
 * @param state The records.
 * @param epochs The protocol version epochs, as the registry of traits keys them.
 * @param chainNow The version the chain has reached.
 * @returns The records with every stranded transaction orphaned.
 */
export const orphanBeyond = <TTransaction, TEpoch>(
  state: TransactionLifecycle<TTransaction>,
  epochs: ProtocolVersion.Registry<TEpoch>,
  chainNow: ProtocolVersion.ProtocolVersion,
): TransactionLifecycle<TTransaction> => ({
  ...state,
  records: state.records.map((record) =>
    pipe(
      record.protocolVersion,
      Option.filter((authoredFor) => isLive(record) && hasEpochEnded(epochs, authoredFor, chainNow)),
      Option.match({
        onNone: () => record,
        onSome: (authoredFor) => ({ ...record, state: LifecycleState.Orphaned({ authoredFor, chainNow }) }),
      }),
    ),
  ),
});

/**
 * Records that a transaction was reverted, so no chain will be asked to include it.
 *
 * @example
 *   const abandoned = reverted(state, [...tx.identifiers()]);
 *
 * @param state The records.
 * @param identifiers The reverted transaction's identifiers.
 * @returns The records with the transaction reverted; a final record is left as it was.
 */
export const reverted = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  identifiers: readonly string[],
): TransactionLifecycle<TTransaction> => settle(state, isCoveredBy(identifiers), LIVE, () => LifecycleState.Reverted());
