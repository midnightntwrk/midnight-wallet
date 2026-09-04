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

import { Array as Arr, DateTime, Duration, Either, HashSet, Option, Order, pipe } from 'effect';
import { type PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities';
import {
  ProtocolVersion,
  WalletTransaction,
  type AnyTx,
  type FinalizedTx,
} from '@midnightntwrk/wallet-sdk-abstractions';
import * as preForkLedger from '@midnight-ntwrk/ledger-v8';
import * as ledger from '@midnightntwrk/ledger-v9';

/**
 * The key under which a transaction's history entry is stored.
 *
 * Prefer the ledger transaction hash — it's the canonical chain identifier and the value the indexer reports a
 * confirmed tx under. `transactionHash()` is only defined for proven + signed + bound transactions, though; it throws
 * for the other variants, notably the proof-erased transactions the simulator produces. In that case fall back to the
 * hex of the tx's serialized bytes: `serialize()` is total over every variant (it's the same encoding used to submit
 * the tx), so a key is always available — unlike `identifiers[0]`, which is an identifier, not a hash of the
 * transaction.
 *
 * Both the submit (pending) and revert (rejected) sides route through this one function so they can never disagree on
 * the key. The fallback is deterministic: the same transaction object yields the same bytes every time, and the
 * auto-revert path reverts the very object it submitted, so the rejected entry lands on the pending entry in place.
 * (Serialization differs across lifecycle states, so this is only stable for a fixed tx — which is exactly the
 * submit→revert flow.)
 */
export const txHistoryHash = (tx: { transactionHash: () => unknown; serialize: () => Uint8Array }): string => {
  try {
    return String(tx.transactionHash());
  } catch {
    return Buffer.from(tx.serialize()).toString('hex');
  }
};

const currentLedgerFinalizedTransactionTrait: PendingTransactions.TransactionTrait<ledger.FinalizedTransaction> = {
  areAllTxIdsIncluded(tx: ledger.FinalizedTransaction, txIds: readonly string[]): boolean {
    const txIdsSet = HashSet.fromIterable(tx.identifiers());
    const expectedIdSet = HashSet.fromIterable(txIds);
    return HashSet.isSubset(txIdsSet, expectedIdSet);
  },
  deserialize(serialized: Uint8Array): ledger.FinalizedTransaction {
    return ledger.Transaction.deserialize('signature', 'proof', 'binding', serialized);
  },
  firstId(tx: ledger.FinalizedTransaction): string {
    return tx.identifiers()[0];
  },
  hasTTLExpired(tx: ledger.FinalizedTransaction, creationTime: DateTime.Utc, now: DateTime.Utc): boolean {
    const defaultShieldedGracePeriod = ledger.LedgerParameters.initialParameters().dust.dustGracePeriodSeconds;
    const intentTTLs = pipe(
      tx.intents?.values().toArray() ?? [],
      Arr.map((i) => i.ttl),
      Arr.filterMap(DateTime.make),
    );
    const hasDustPayments = pipe(
      tx.intents?.values().toArray() ?? [],
      Arr.flatMap((i) => i.dustActions?.spends ?? []),
      Arr.isNonEmptyArray,
    );
    const hasShieldedOffers = tx.guaranteedOffer != null || (tx.fallibleOffer?.size ?? 0) == 0;
    const maybeShieldedTTL: readonly DateTime.Utc[] =
      hasDustPayments || hasShieldedOffers
        ? pipe(creationTime, DateTime.addDuration(Duration.seconds(Number(defaultShieldedGracePeriod))), Arr.of)
        : Arr.empty();

    return pipe(
      intentTTLs,
      Arr.appendAll(maybeShieldedTTL),
      (arr: readonly DateTime.Utc[]): Option.Option<DateTime.Utc> =>
        Arr.isNonEmptyReadonlyArray(arr)
          ? Option.some(Arr.min(arr, Order.mapInput(Order.Date, DateTime.toDate)))
          : Option.none(),
      Option.match({
        onNone: () => false,
        onSome: (finalTTL: DateTime.Utc) => DateTime.distance(finalTTL, now) > 0,
      }),
    );
  },
  ids(tx: ledger.FinalizedTransaction): readonly string[] {
    return tx.identifiers();
  },
  isOneIncludedInOther(tx: ledger.FinalizedTransaction, otherTx: ledger.FinalizedTransaction): boolean {
    const txIds = HashSet.fromIterable(tx.identifiers());
    const otherTxIds = HashSet.fromIterable(otherTx.identifiers());
    const smallerSize = Order.min(Order.number)(HashSet.size(txIds), HashSet.size(otherTxIds));
    const intersection = HashSet.intersection(txIds, otherTxIds);
    return HashSet.size(intersection) == smallerSize;
  },
  isTx(tx: unknown): tx is ledger.FinalizedTransaction {
    return tx instanceof ledger.Transaction;
  },
  serialize(tx: ledger.FinalizedTransaction): Uint8Array {
    return tx.serialize();
  },
};

/**
 * The pre-fork ledger version's reading of a pending transaction.
 *
 * @remarks
 *   Structurally the same as the current ledger version's — identifiers, a TTL, bytes — against a different ledger
 *   version's classes. It is the classes that make this a separate trait: `instanceof` distinguishes them, each
 *   deserializer refuses the other's bytes, and a grace period is read off that version's own initial parameters.
 */
const preForkFinalizedTransactionTrait: PendingTransactions.TransactionTrait<preForkLedger.FinalizedTransaction> = {
  areAllTxIdsIncluded(tx, txIds) {
    return HashSet.isSubset(HashSet.fromIterable(tx.identifiers()), HashSet.fromIterable(txIds));
  },
  deserialize(serialized) {
    return preForkLedger.Transaction.deserialize('signature', 'proof', 'binding', serialized);
  },
  firstId(tx) {
    return tx.identifiers()[0];
  },
  hasTTLExpired(tx, creationTime, now) {
    const defaultShieldedGracePeriod = preForkLedger.LedgerParameters.initialParameters().dust.dustGracePeriodSeconds;
    const intentTTLs = pipe(
      tx.intents?.values().toArray() ?? [],
      Arr.map((i) => i.ttl),
      Arr.filterMap(DateTime.make),
    );
    const hasDustPayments = pipe(
      tx.intents?.values().toArray() ?? [],
      Arr.flatMap((i) => i.dustActions?.spends ?? []),
      Arr.isNonEmptyArray,
    );
    const hasShieldedOffers = tx.guaranteedOffer != null || (tx.fallibleOffer?.size ?? 0) == 0;
    const maybeShieldedTTL: readonly DateTime.Utc[] =
      hasDustPayments || hasShieldedOffers
        ? pipe(creationTime, DateTime.addDuration(Duration.seconds(Number(defaultShieldedGracePeriod))), Arr.of)
        : Arr.empty();

    return pipe(
      intentTTLs,
      Arr.appendAll(maybeShieldedTTL),
      (arr: readonly DateTime.Utc[]): Option.Option<DateTime.Utc> =>
        Arr.isNonEmptyReadonlyArray(arr)
          ? Option.some(Arr.min(arr, Order.mapInput(Order.Date, DateTime.toDate)))
          : Option.none(),
      Option.match({
        onNone: () => false,
        onSome: (finalTTL: DateTime.Utc) => DateTime.distance(finalTTL, now) > 0,
      }),
    );
  },
  ids(tx) {
    return tx.identifiers();
  },
  isOneIncludedInOther(tx, otherTx) {
    const txIds = HashSet.fromIterable(tx.identifiers());
    const otherTxIds = HashSet.fromIterable(otherTx.identifiers());
    const smallerSize = Order.min(Order.number)(HashSet.size(txIds), HashSet.size(otherTxIds));
    return HashSet.size(HashSet.intersection(txIds, otherTxIds)) == smallerSize;
  },
  isTx(tx: unknown): tx is preForkLedger.FinalizedTransaction {
    return tx instanceof preForkLedger.Transaction;
  },
  serialize(tx) {
    return tx.serialize();
  },
};

/**
 * Lifts one ledger version's trait onto the handle the facade actually carries.
 *
 * @remarks
 *   The router has already chosen this trait by the version stamped on the handle, so unwrapping at the same epoch is a
 *   restatement of the choice rather than a second one — but it is where a handle that does not belong is refused
 *   rather than handed to a reader that would misread it. A handle it cannot read is reported as not being its
 *   transaction at all, which is precisely what `isTx` is for.
 * @param trait The ledger version's own reading of a transaction.
 * @param epoch The range of protocol versions that ledger version answers for.
 * @returns The same reading, in terms of handles.
 */
const overHandles = <T extends { serialize: () => Uint8Array }>(
  trait: PendingTransactions.TransactionTrait<T>,
  epoch: ProtocolVersion.ProtocolVersion.Range,
): PendingTransactions.TransactionTrait<FinalizedTx> => {
  const [stamp] = epoch;
  const carried = (handle: AnyTx): T => Either.getOrThrow(WalletTransaction.unwrapWithin<T>(handle, epoch));
  return {
    ids: (tx) => trait.ids(carried(tx)),
    firstId: (tx) => trait.firstId(carried(tx)),
    areAllTxIdsIncluded: (tx, txIds) => trait.areAllTxIdsIncluded(carried(tx), txIds),
    isOneIncludedInOther: (tx, otherTx) => trait.isOneIncludedInOther(carried(tx), carried(otherTx)),
    hasTTLExpired: (tx, creationTime, now) => trait.hasTTLExpired(carried(tx), creationTime, now),
    serialize: (tx) => trait.serialize(carried(tx)),
    deserialize: (serialized) => WalletTransaction.adopt('Finalized', trait.deserialize(serialized), stamp),
    isTx: (tx: unknown): tx is FinalizedTx =>
      WalletTransaction.is(tx) &&
      Either.match(WalletTransaction.unwrapWithin<unknown>(tx, epoch), {
        onLeft: () => false,
        onRight: (carried) => trait.isTx(carried),
      }),
  };
};

/**
 * The traits pending transactions are read with, split at the protocol version this chain forks at.
 *
 * @remarks
 *   One trait per ledger version, each reading the handle it is registered for and refusing the other's. That is what
 *   lets a transaction authored before the fork be recognised as stranded once the wallets cross — its bytes can never
 *   be included afterwards — instead of waiting out a TTL for an inclusion that can never happen.
 * @param forkVersion The protocol version this chain forks at.
 * @returns The registry the pending transaction service reads with.
 */
export const finalizedTransactionTraits = (
  forkVersion: ProtocolVersion.ProtocolVersion,
): PendingTransactions.VersionedTransactionTrait<FinalizedTx> =>
  Either.getOrThrow(
    ProtocolVersion.makeRegistryFromActivations(
      forkVersion > ProtocolVersion.MinSupportedVersion
        ? [
            {
              sinceVersion: ProtocolVersion.MinSupportedVersion,
              value: overHandles(
                preForkFinalizedTransactionTrait,
                ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, forkVersion),
              ),
            },
            {
              sinceVersion: forkVersion,
              value: overHandles(
                currentLedgerFinalizedTransactionTrait,
                ProtocolVersion.epochOf(forkVersion, forkVersion),
              ),
            },
          ]
        : [
            {
              sinceVersion: ProtocolVersion.MinSupportedVersion,
              value: overHandles(
                currentLedgerFinalizedTransactionTrait,
                ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, ProtocolVersion.MinSupportedVersion),
              ),
            },
          ],
    ),
  );
