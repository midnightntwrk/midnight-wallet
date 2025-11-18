// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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

export const UnshieldedTransactions = Subscription.make(
  'UnshieldedTransactions',
  gql(`
    subscription UnshieldedTransactions($address: UnshieldedAddress!, $transactionId: Int) {
      unshieldedTransactions(address: $address, transactionId: $transactionId) {
        ... on UnshieldedTransaction {
          type: __typename
          transaction {
            type: __typename
            id
            hash
            protocolVersion
            ... on RegularTransaction {
              identifiers
              transactionResult {
                status
                segments {
                  id
                  success
                }
              }
            }
          }
          createdUtxos {
            owner
            tokenType
            value
            outputIndex
            intentHash
            ctime
            registeredForDustGeneration
          }
          spentUtxos {
            owner
            tokenType
            value
            outputIndex
            intentHash
            ctime
            registeredForDustGeneration
          }
        }
        ... on UnshieldedTransactionsProgress {
          type: __typename
          highestTransactionId
        }
      }
    }
  `),
);
