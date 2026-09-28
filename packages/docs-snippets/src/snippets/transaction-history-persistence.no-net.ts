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
// The transaction history lives in its own storage, beside the wallet snapshot, and an application persists the two
// separately: `serialize()` on the storage gives a string to save, and `restore` opens it again on the next start. A
// saved history is versioned, so one written by an earlier SDK opens too, upgraded on the way in; one this SDK cannot
// read is refused with a tagged error rather than opened as an empty history. Nothing here touches the network.
import { Either } from 'effect';
import {
  InMemoryTransactionHistoryStorage,
  TransactionHistoryFormat,
  WalletEntrySchema,
  mergeWalletEntries,
} from '@midnightntwrk/wallet-sdk';

// #region persist
// The storage the wallet writes to, the same object `txHistoryStorage` in the configuration points at.
const txHistoryStorage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);

// A wallet records entries as it syncs; this stands in for one it recorded.
await txHistoryStorage.gotFinalized({
  hash: 'c0a46613b653a5c6f14a369f3799cdb122a57c3ec83a9f1358717fa8a2221204',
  identifiers: ['identifier-1'],
  finalizedBlock: { hash: 'block-hash', height: 42, timestamp: new Date('2026-04-01T00:00:00.000Z') },
});

// Save this string wherever the wallet snapshot is saved.
const savedHistory = await txHistoryStorage.serialize();
// #endregion persist

// #region restore
// On the next start, open it and hand the storage to the wallet configuration as `txHistoryStorage`. `restore` throws
// a `TransactionHistoryRestoreError` for a payload it cannot read; `tryRestore` returns the same as a `Left` instead.
const restored = InMemoryTransactionHistoryStorage.restore(savedHistory, WalletEntrySchema, mergeWalletEntries);
console.log(
  'restored entries',
  (await restored.getAll()).map((entry) => entry.hash),
);

const attempted = InMemoryTransactionHistoryStorage.tryRestore(savedHistory, WalletEntrySchema, mergeWalletEntries);
console.log('tryRestore succeeded', Either.isRight(attempted));
// #endregion restore

// #region older-and-newer
// A history saved by an SDK before the envelope existed is a bare array. It opens, upgraded on the way in.
const savedByAnOlderSdk = JSON.stringify([
  { hash: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', identifiers: [], status: 'SUCCESS' },
]);
const upgraded = InMemoryTransactionHistoryStorage.restore(savedByAnOlderSdk, WalletEntrySchema, mergeWalletEntries);
console.log('older history entries', (await upgraded.getAll()).length);

// A history saved by a newer SDK, in a format this one does not know, is refused. The error says which surface, which
// version it found, and why, so the application can tell "written by a newer SDK" from "corrupt".
const savedByANewerSdk = JSON.stringify({ version: 'v9', entries: [] });
try {
  InMemoryTransactionHistoryStorage.restore(savedByANewerSdk, WalletEntrySchema, mergeWalletEntries);
} catch (error) {
  if (error instanceof TransactionHistoryFormat.TransactionHistoryRestoreError) {
    console.log('refused', error.reason, error.detectedVersion);
    console.log(error.message);
  }
}
// #endregion older-and-newer
