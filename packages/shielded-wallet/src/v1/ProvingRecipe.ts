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
import * as ledger from '@midnight-ntwrk/ledger-v7';
export const TRANSACTION_TO_PROVE = 'TransactionToProve';
export const BALANCE_TRANSACTION_TO_PROVE = 'BalanceTransactionToProve';
export const NOTHING_TO_PROVE = 'NothingToProve';

export type TransactionToProve = {
  readonly type: typeof TRANSACTION_TO_PROVE;
  readonly transaction: ledger.UnprovenTransaction;
};

export type BalanceTransactionToProve<Transaction> = {
  readonly type: typeof BALANCE_TRANSACTION_TO_PROVE;
  readonly transactionToProve: ledger.UnprovenTransaction;
  readonly transactionToBalance: Transaction;
};

export type NothingToProve<Transaction> = {
  readonly type: typeof NOTHING_TO_PROVE;
  readonly transaction: Transaction;
};

export type ProvingRecipe<Transaction> =
  | TransactionToProve
  | BalanceTransactionToProve<Transaction>
  | NothingToProve<Transaction>;
