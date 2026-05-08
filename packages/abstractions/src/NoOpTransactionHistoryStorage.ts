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
import {
  type TransactionHistoryStorage,
  type TransactionHash,
  type TransactionHistoryCommon,
  type FinalizedTransactionHistoryCommon,
  type FinalizedEntryInput,
  type SerializedTransactionHistory,
  type TransactionRef,
} from './TransactionHistoryStorage.js';

export class NoOpTransactionHistoryStorage<
  TRead extends { hash: TransactionHash } = TransactionHistoryCommon,
> implements TransactionHistoryStorage<TRead> {
  gotPending(_tx: TransactionRef, _submittedAt: Date): Promise<void> {
    return Promise.resolve();
  }

  gotFinalized(_entry: FinalizedEntryInput<Extract<TRead, FinalizedTransactionHistoryCommon>>): Promise<void> {
    return Promise.resolve();
  }

  gotRejected(_tx: TransactionRef, _rejectedAt: Date, _reason?: string): Promise<void> {
    return Promise.resolve();
  }

  getAll(): Promise<readonly TRead[]> {
    return Promise.resolve([]);
  }

  get(_hash: TransactionHash): Promise<TRead | undefined> {
    return Promise.resolve(undefined);
  }

  serialize(): Promise<SerializedTransactionHistory> {
    return Promise.resolve('[]');
  }
}
