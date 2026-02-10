/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) 2025 Midnight Foundation
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

import { Array as Arr, DateTime, Duration, HashSet, Option, Order, pipe } from 'effect';
import { PendingTransactions } from '@midnight-ntwrk/wallet-sdk-capabilities';
import * as ledger from '@midnight-ntwrk/ledger-v7';

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
