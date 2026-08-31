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
import { Subscription } from '../../effect/index.js';
import { gql } from '../generated/index.js';

/**
 * Reads how far an address's unshielded transaction timeline goes, by taking the first thing the source says about it.
 *
 * @remarks
 *   The unshielded counterpart of {@link ZswapEventTip}, and it exists for the same reason: the schema has no query that
 *   answers "the highest transaction id for this address" — `Query.transactions` takes an offset and returns
 *   transactions, and nothing aggregates them per owner. The subscription's progress arm is the only place the indexer
 *   states it, and it states it eagerly: the progress loop emits before its first sleep, so the frame arrives on any
 *   address, including one the chain has never mentioned (it reports `0` there).
 *
 *   Separate from {@link UnshieldedTransactions} despite naming the same subscription field: the two ask different
 *   questions of it — one reads the timeline, this one reads how long the timeline is — so this carries no UTXO or
 *   block payload at all, and, more importantly, its own injection tag, which is what lets a caller stand in for one
 *   without standing in for the other.
 *
 *   The transaction arm selects nothing but its type on purpose. A caller opens this one past its own cursor, so a
 *   transaction frame arriving at all is the whole answer — there is unapplied history — and none of its contents
 *   change that.
 */
export const UnshieldedTransactionTip = Subscription.make(
  'UnshieldedTransactionTip',
  gql(`
    subscription UnshieldedTransactionTip($address: UnshieldedAddress!, $transactionId: Int) {
      unshieldedTransactions(address: $address, transactionId: $transactionId) {
        ... on UnshieldedTransaction {
          type: __typename
        }
        ... on UnshieldedTransactionsProgress {
          type: __typename
          highestTransactionId
        }
      }
    }
  `),
);
