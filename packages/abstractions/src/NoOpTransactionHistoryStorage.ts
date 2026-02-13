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
import {
  type TransactionHistoryStorage,
  type TransactionHash,
  type TransactionHistoryEntryWithHash,
} from './TransactionHistoryStorage.js';

export class NoOpTransactionHistoryStorage<
  T extends TransactionHistoryEntryWithHash,
> implements TransactionHistoryStorage<T> {
  create(_entry: T): Promise<void> {
    return Promise.resolve();
  }

  delete(_hash: TransactionHash): Promise<T | undefined> {
    return Promise.resolve(undefined);
  }

  async *getAll(): AsyncIterableIterator<T> {
    return Promise.resolve(yield* []);
  }

  get(_hash: TransactionHash): Promise<T | undefined> {
    return Promise.resolve(undefined);
  }

  serialize(): string {
    return JSON.stringify({});
  }

  // TODO IAN - IS this really needed ?
  // static deserialize(_serialized: string): NoOpTransactionHistoryStorage {
  //   return new NoOpTransactionHistoryStorage();
  // }
}
