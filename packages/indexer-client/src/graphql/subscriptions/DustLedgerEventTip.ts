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
 * Reads the highest dust ledger event id the indexer holds, by taking one event and asking it.
 *
 * @remarks
 *   The dust twin of {@link ZswapEventTip}, and for the same reasons. `maxId` is a property of the whole timeline, so
 *   **any** event answers it: the caller takes the first one delivered and closes the stream. It is a subscription
 *   rather than a query only because the schema offers no query that reaches a `DustLedgerEvent` — `Query.block` and
 *   `Query.transactions` reach one only through a block that happens to contain dust events, which on a quiet chain is
 *   precisely the block that does not.
 *
 *   Separate from {@link DustLedgerEvents} despite naming the same subscription field: the two ask different questions of
 *   it — one reads the timeline, this one reads how long the timeline is — so they carry different selection sets (no
 *   `raw` here, the bytes are never wanted) and, more importantly, different injection tags, which is what lets a
 *   caller stand in for one without standing in for the other.
 */
export const DustLedgerEventTip = Subscription.make(
  'DustLedgerEventTip',
  gql(`
    subscription DustLedgerEventTip($id: Int) {
      dustLedgerEvents(id: $id) {
        id
        maxId
      }
    }
  `),
);
