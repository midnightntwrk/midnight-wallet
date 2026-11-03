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

import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type DateTime, Option } from 'effect';

/**
 * Ids of the coins a transaction spends, per wallet: unshielded coins as `intentHash#outputNo`, shielded coins by
 * nullifier.
 */
export type Inputs = Readonly<{ unshielded: readonly string[]; shielded?: readonly string[] }>;

export type TransactionTrait<TTransaction> = {
  ids: (tx: TTransaction) => readonly string[];
  firstId: (tx: TTransaction) => string;
  areAllTxIdsIncluded: (tx: TTransaction, txIds: readonly string[]) => boolean;
  isOneIncludedInOther: (tx: TTransaction, otherTx: TTransaction) => boolean;
  hasTTLExpired: (tx: TTransaction, txCreationTime: DateTime.Utc, now: DateTime.Utc) => boolean;
  /** The hash of each intent the transaction carries: the value the ledger stamps on the coins it creates. */
  intentHashes: (tx: TTransaction) => readonly string[];
  /**
   * Every coin the transaction spends, whoever owns it: unshielded coins as `intentHash#outputNo`, shielded coins by
   * nullifier, with `shielded` absent when it spends none.
   */
  inputs: (tx: TTransaction) => Inputs;
  /** The instant after which the transaction can no longer be included, for one created at `createdAt`. */
  ttl: (tx: TTransaction, createdAt: DateTime.Utc) => Date;
  serialize: (tx: TTransaction) => Uint8Array;
  deserialize: (serialized: Uint8Array) => TTransaction;
  isTx: (tx: unknown) => tx is TTransaction;
};
export type HasTransactionTrait<TTransaction> = { txTrait: TransactionTrait<TTransaction> };

/**
 * The transaction traits a wallet reads its transactions with, keyed by the protocol version range each one serves.
 *
 * @remarks
 *   A transaction's bytes, identifiers and TTL are only meaningful under the ledger version it was authored against, so
 *   which trait applies is a property of the transaction rather than of the wallet holding it. Keeping that in the
 *   shared {@link ProtocolVersion.Registry} means the boundary between two traits is the same boundary variant selection
 *   and codec selection use.
 */
export type VersionedTransactionTrait<TTransaction> = ProtocolVersion.Registry<TransactionTrait<TTransaction>>;

export type HasVersionedTransactionTrait<TTransaction> = { txTraits: VersionedTransactionTrait<TTransaction> };

/** Registers one trait for every protocol version: the shape a wallet that speaks a single ledger version has. */
export const singleTrait = <TTransaction>(
  trait: TransactionTrait<TTransaction>,
): VersionedTransactionTrait<TTransaction> => ({
  entries: [
    {
      range: ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, ProtocolVersion.MaxSupportedVersion),
      value: trait,
    },
  ],
});

/** The oldest registered trait: what an envelope that carries no version stamp is read with. */
export const headTrait = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
): Option.Option<TransactionTrait<TTransaction>> =>
  Option.fromNullable(traits.entries.at(0)).pipe(Option.map((entry) => entry.value));

/**
 * The trait registered for a protocol version, or the oldest trait when nothing says which version applies.
 *
 * @remarks
 *   Falling back to the oldest trait is the same convention snapshot restore uses for an envelope written before versions
 *   were recorded: the only envelopes without a stamp are ones written before stamping existed, and those necessarily
 *   predate every version boundary since.
 * @param traits The registered traits.
 * @param protocolVersion The version the transaction was authored for, when one is known.
 * @returns The trait to read with, or `Option.none()` when the version falls outside every registered range.
 */
export const traitForVersion = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
  protocolVersion: Option.Option<ProtocolVersion.ProtocolVersion>,
): Option.Option<TransactionTrait<TTransaction>> =>
  Option.match(protocolVersion, {
    onNone: () => headTrait(traits),
    onSome: (version) => ProtocolVersion.select(traits, version),
  });

/** The registered trait that recognises a transaction object as its own, if any does. */
export const recognisingTrait = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
  tx: unknown,
): Option.Option<TransactionTrait<TTransaction>> =>
  Option.fromNullable(traits.entries.find((entry) => entry.value.isTx(tx))).pipe(Option.map((entry) => entry.value));

/**
 * The trait to read an incoming transaction with: the one that recognises it, or the oldest as a last resort.
 *
 * @param traits The registered traits.
 * @param tx The transaction to place.
 * @returns The trait that owns `tx`, the oldest trait when none claims it, or `Option.none()` when nothing is
 *   registered at all.
 */
export const traitForTx = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
  tx: TTransaction,
): Option.Option<TransactionTrait<TTransaction>> =>
  Option.orElse(recognisingTrait(traits, tx), () => headTrait(traits));

// Compatible with the GraphQL API
export type FailedTransactionResult = Readonly<{
  segments: ReadonlyArray<{ id: number; success: boolean }>;
  status: 'PARTIAL_SUCCESS' | 'FAILURE';
}>;
export type SuccessTransactionResult = Readonly<{
  segments: ReadonlyArray<{ id: number; success: boolean }>;
  status: 'SUCCESS';
}>;

/**
 * The verdict on a transaction a protocol upgrade left behind.
 *
 * @remarks
 *   Deliberately not one of the indexer's statuses: the chain never reported anything about this transaction and never
 *   will, because bytes authored under the previous protocol version cannot be included under the new one. Saying so in
 *   its own arm keeps "the node rejected this" and "this can no longer be submitted at all" distinguishable.
 */
export type OrphanedByForkResult = Readonly<{
  status: 'ORPHANED_BY_FORK';
  /** The protocol version the transaction was authored for. */
  authoredFor: ProtocolVersion.ProtocolVersion;
  /** The protocol version the chain had reached when the wallet gave up on it. */
  chainNow: ProtocolVersion.ProtocolVersion;
}>;

export type TransactionResult = FailedTransactionResult | SuccessTransactionResult | OrphanedByForkResult;
