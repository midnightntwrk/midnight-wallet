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
import {
  type FinalizedEntryInput,
  type PendingEntryInput,
  type RejectedEntryInput,
  type TransactionHistoryEntryCommon,
  TransactionHistoryEntryCommonSchema,
} from '../TransactionHistoryStorage.js';
import { InMemoryTransactionHistoryStorage } from '../InMemoryTransactionHistoryStorage.js';

const finalizedInput = (
  hash: string,
  overrides: Partial<FinalizedEntryInput<TransactionHistoryEntryCommon>> = {},
): FinalizedEntryInput<TransactionHistoryEntryCommon> => ({
  hash,
  identifiers: [],
  protocolVersion: 1,
  status: 'SUCCESS',
  finalizedBlock: { hash: 'block-hash', height: 0, timestamp: new Date(0) },
  ...overrides,
});

const pendingInput = (
  hash: string,
  identifiers: readonly string[],
  submittedAt: Date = new Date(0),
): PendingEntryInput<TransactionHistoryEntryCommon> => ({ hash, identifiers, submittedAt });

const rejectedInput = (
  hash: string,
  identifiers: readonly string[],
  rejectedAt: Date,
  reason?: string,
): RejectedEntryInput<TransactionHistoryEntryCommon> => ({
  hash,
  identifiers,
  rejectedAt,
  ...(reason !== undefined ? { reason } : {}),
});

const mergeEntries = (
  existing: TransactionHistoryEntryCommon,
  incoming: TransactionHistoryEntryCommon,
): TransactionHistoryEntryCommon => ({
  ...existing,
  ...incoming,
  identifiers: [...new Set([...existing.identifiers, ...incoming.identifiers])],
});

describe('InMemoryTransactionHistoryStorage gotFinalized respects the merge function', () => {
  it('should merge identifiers when two finalized entries arrive under the same hash', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    await storage.gotFinalized(finalizedInput('tx1', { identifiers: ['id-a'] }));
    await storage.gotFinalized(finalizedInput('tx1', { identifiers: ['id-b'] }));

    const result = await storage.get('tx1');

    expect(result?.identifiers).toEqual(['id-a', 'id-b']);
  });

  it('should insert without merging when no prior entry exists for that hash', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    await storage.gotFinalized(finalizedInput('tx1', { identifiers: ['id-a'] }));

    const result = await storage.get('tx1');

    expect(result?.identifiers).toEqual(['id-a']);
  });

  it('should keep entries with different hashes independent', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    await storage.gotFinalized(finalizedInput('tx1', { identifiers: ['id-a'] }));
    await storage.gotFinalized(finalizedInput('tx2', { identifiers: ['id-b'] }));

    const result1 = await storage.get('tx1');
    const result2 = await storage.get('tx2');

    expect(result1?.identifiers).toEqual(['id-a']);
    expect(result2?.identifiers).toEqual(['id-b']);
  });

  it('should attach a finalized lifecycle to entries inserted via gotFinalized', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    const finalizedBlock = {
      hash: 'block-hash-1',
      height: 42,
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
    };
    await storage.gotFinalized(finalizedInput('tx1', { identifiers: ['id-a'], finalizedBlock }));

    const result = await storage.get('tx1');

    expect(result?.lifecycle).toEqual({ status: 'finalized', finalizedBlock });
  });
});

describe('InMemoryTransactionHistoryStorage gotPending / gotRejected', () => {
  it('should store a pending entry under its hash with a pending lifecycle', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    const submittedAt = new Date('2026-01-01T00:00:00.000Z');
    await storage.gotPending(pendingInput('tx-hash', ['first-id', 'second-id'], submittedAt));

    const result = await storage.get('tx-hash');

    expect(result).toBeDefined();
    expect(result?.lifecycle).toEqual({ status: 'pending', submittedAt });
    expect(result?.identifiers).toEqual(['first-id', 'second-id']);
  });

  it('should clear a pending entry when its finalized counterpart arrives via gotFinalized', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    // Pending was inserted under a fallback key (e.g. first identifier) because the tx wasn't yet hashable.
    await storage.gotPending(pendingInput('first-id', ['first-id', 'second-id']));
    expect(await storage.get('first-id')).toBeDefined();

    await storage.gotFinalized(finalizedInput('chain-hash', { identifiers: ['first-id', 'second-id', 'extra-id'] }));

    expect(await storage.get('first-id')).toBeUndefined();
    expect(await storage.get('chain-hash')).toBeDefined();
  });

  it('should transition a pending entry to rejected via gotRejected', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    await storage.gotPending(pendingInput('first-id', ['first-id']));

    const rejectedAt = new Date('2026-01-02T00:00:00.000Z');
    await storage.gotRejected(rejectedInput('first-id', ['first-id'], rejectedAt, 'TTL expired'));

    const result = await storage.get('first-id');

    expect(result?.lifecycle).toEqual({ status: 'rejected', rejectedAt, reason: 'TTL expired' });
  });
});
