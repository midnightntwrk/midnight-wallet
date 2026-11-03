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
import { Data, type DateTime, type Option } from 'effect';
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

/**
 * Records a transaction as balanced.
 *
 * @param state The records.
 * @param facts The balanced transaction, with its proofs erased.
 * @param now When it was balanced.
 * @returns The records with the transaction balanced.
 */
export const balanced = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  _facts: TransactionFacts<TTransaction>,
  _now: DateTime.Utc,
): TransactionLifecycle<TTransaction> => state;

/**
 * Records a transaction as finalized.
 *
 * @param state The records.
 * @param facts The finalized transaction.
 * @param now When it was finalized.
 * @returns The records with the transaction finalized.
 */
export const finalized = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  _facts: TransactionFacts<TTransaction>,
  _now: DateTime.Utc,
): TransactionLifecycle<TTransaction> => state;

/**
 * Records a transaction as submitted.
 *
 * @param state The records.
 * @param facts The submitted transaction.
 * @param now When it was submitted.
 * @returns The records with the transaction submitted.
 */
export const submitted = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  _facts: TransactionFacts<TTransaction>,
  _now: DateTime.Utc,
): TransactionLifecycle<TTransaction> => state;
