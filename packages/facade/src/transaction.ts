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
import { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import * as ledger from '@midnightntwrk/ledger-v9';
import { type AnyTransaction } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';

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
export const txHistoryHash = (tx: AnyTransaction): string => {
  try {
    return tx.transactionHash().toString();
  } catch {
    return Buffer.from(tx.serialize()).toString('hex');
  }
};

export const finalizedTransactionTrait: PendingTransactions.TransactionTrait<ledger.FinalizedTransaction> = {
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
 * The traits pending transactions are read with, split at the protocol version this chain forks at.
 *
 * @remarks
 *   Both entries hold the same trait today, and that is not an oversight: the facade only ever carries ledger-v9
 *   transaction objects, whichever protocol version the chain was at when they were authored, so one reader answers
 *   for both sides. What the split buys is the boundary itself — it makes pre-fork and post-fork different version
 *   epochs, which is what lets a transaction authored before the fork be recognised as stranded once the wallets
 *   cross, instead of waiting out a TTL for an inclusion that can never happen.
 *
 *   The pre-fork entry becomes a ledger-v8 trait when the facade's transaction surface learns to carry pre-fork bytes.
 * @param forkVersion The protocol version this chain forks at.
 * @returns The registry the pending transaction service reads with.
 */
export const finalizedTransactionTraits = (
  forkVersion: ProtocolVersion.ProtocolVersion,
): PendingTransactions.VersionedTransactionTrait<ledger.FinalizedTransaction> =>
  Either.getOrThrow(
    ProtocolVersion.makeRegistryFromActivations(
      forkVersion > ProtocolVersion.MinSupportedVersion
        ? [
            { sinceVersion: ProtocolVersion.MinSupportedVersion, value: finalizedTransactionTrait },
            { sinceVersion: forkVersion, value: finalizedTransactionTrait },
          ]
        : [{ sinceVersion: ProtocolVersion.MinSupportedVersion, value: finalizedTransactionTrait }],
    ),
  );
