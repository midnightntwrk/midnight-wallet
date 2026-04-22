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
import { describe, it, expect } from 'vitest';
import { type TransactionHistoryCommon, TransactionHistoryCommonSchema } from '../TransactionHistoryStorage.js';
import { InMemoryTransactionHistoryStorage } from '../InMemoryTransactionHistoryStorage.js';

const baseEntry = (hash: string, overrides: Partial<TransactionHistoryCommon> = {}): TransactionHistoryCommon => ({
  hash,
  protocolVersion: 1,
  status: 'SUCCESS',
  ...overrides,
});

const mergeEntries = (
  existing: TransactionHistoryCommon,
  incoming: TransactionHistoryCommon,
): TransactionHistoryCommon => ({
  ...existing,
  ...incoming,
  ...(existing.identifiers !== undefined && incoming.identifiers !== undefined
    ? { identifiers: [...new Set([...existing.identifiers, ...incoming.identifiers])] }
    : {}),
});

describe('InMemoryTransactionHistoryStorage upsert respects the merge function', () => {
  it('should use the provided merge function when upserting an entry with the same hash', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryCommonSchema, mergeEntries);

    await storage.upsert(baseEntry('tx1', { identifiers: ['id-a'] }));
    await storage.upsert(baseEntry('tx1', { identifiers: ['id-b'] }));

    const result = await storage.get('tx1');

    expect(result?.identifiers).toEqual(['id-a', 'id-b']);
  });

  it('should insert without merging when no prior entry exists for that hash', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryCommonSchema, mergeEntries);

    await storage.upsert(baseEntry('tx1', { identifiers: ['id-a'] }));

    const result = await storage.get('tx1');

    expect(result?.identifiers).toEqual(['id-a']);
  });

  it('should keep entries with different hashes independent', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryCommonSchema, mergeEntries);

    await storage.upsert(baseEntry('tx1', { identifiers: ['id-a'] }));
    await storage.upsert(baseEntry('tx2', { identifiers: ['id-b'] }));

    const result1 = await storage.get('tx1');
    const result2 = await storage.get('tx2');

    expect(result1?.identifiers).toEqual(['id-a']);
    expect(result2?.identifiers).toEqual(['id-b']);
  });
});
