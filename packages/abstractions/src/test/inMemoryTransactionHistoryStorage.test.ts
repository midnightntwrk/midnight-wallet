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
  type FinalizedTransactionHistoryCommon,
  type TransactionHistoryCommon,
  type TransactionRef,
  TransactionHistoryCommonSchema,
} from '../TransactionHistoryStorage.js';
import { InMemoryTransactionHistoryStorage } from '../InMemoryTransactionHistoryStorage.js';

const finalizedInput = (
  hash: string,
  overrides: Partial<FinalizedEntryInput<FinalizedTransactionHistoryCommon>> = {},
): FinalizedEntryInput<FinalizedTransactionHistoryCommon> => ({
  hash,
  protocolVersion: 1,
  status: 'SUCCESS',
  finalizedAt: new Date(0),
  ...overrides,
});

const txRef = (identifiers: readonly string[], hash?: string): TransactionRef => ({
  identifiers: () => identifiers,
  ...(hash !== undefined ? { transactionHash: () => ({ toString: () => hash }) } : {}),
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

describe('InMemoryTransactionHistoryStorage gotFinalized respects the merge function', () => {
  it('should merge identifiers when two finalized entries arrive under the same hash', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryCommonSchema, mergeEntries);

    await storage.gotFinalized(finalizedInput('tx1', { identifiers: ['id-a'] }));
    await storage.gotFinalized(finalizedInput('tx1', { identifiers: ['id-b'] }));

    const result = await storage.get('tx1');

    expect(result?.identifiers).toEqual(['id-a', 'id-b']);
  });

  it('should insert without merging when no prior entry exists for that hash', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryCommonSchema, mergeEntries);

    await storage.gotFinalized(finalizedInput('tx1', { identifiers: ['id-a'] }));

    const result = await storage.get('tx1');

    expect(result?.identifiers).toEqual(['id-a']);
  });

  it('should keep entries with different hashes independent', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryCommonSchema, mergeEntries);

    await storage.gotFinalized(finalizedInput('tx1', { identifiers: ['id-a'] }));
    await storage.gotFinalized(finalizedInput('tx2', { identifiers: ['id-b'] }));

    const result1 = await storage.get('tx1');
    const result2 = await storage.get('tx2');

    expect(result1?.identifiers).toEqual(['id-a']);
    expect(result2?.identifiers).toEqual(['id-b']);
  });

  it('should attach a finalized lifecycle to entries inserted via gotFinalized', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryCommonSchema, mergeEntries);

    const finalizedAt = new Date('2026-01-01T00:00:00.000Z');
    await storage.gotFinalized(finalizedInput('tx1', { identifiers: ['id-a'], finalizedAt }));

    const result = await storage.get('tx1');

    expect(result?.lifecycle).toEqual({ status: 'finalized', finalizedAt });
  });
});

describe('InMemoryTransactionHistoryStorage gotPending / gotRejected', () => {
  it('should record a pending entry keyed by the tx hash when available', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryCommonSchema, mergeEntries);

    const submittedAt = new Date('2026-01-01T00:00:00.000Z');
    await storage.gotPending(txRef(['first-id', 'second-id'], 'tx-hash'), submittedAt);

    const result = await storage.get('tx-hash');

    expect(result).toBeDefined();
    expect(result?.lifecycle).toEqual({ status: 'pending', submittedAt });
    expect(result?.identifiers).toEqual(['first-id', 'second-id']);
  });

  it('should fall back to the first identifier when transactionHash is unavailable', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryCommonSchema, mergeEntries);

    const submittedAt = new Date('2026-01-01T00:00:00.000Z');
    await storage.gotPending(txRef(['first-id', 'second-id']), submittedAt);

    const result = await storage.get('first-id');

    expect(result).toBeDefined();
    expect(result?.lifecycle).toEqual({ status: 'pending', submittedAt });
    expect(result?.identifiers).toEqual(['first-id', 'second-id']);
  });

  it('should fall back to the first identifier when transactionHash throws', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryCommonSchema, mergeEntries);

    const submittedAt = new Date('2026-01-01T00:00:00.000Z');
    const tx: TransactionRef = {
      identifiers: () => ['first-id'],
      transactionHash: () => {
        throw new Error('not hashable');
      },
    };
    await storage.gotPending(tx, submittedAt);

    expect(await storage.get('first-id')).toBeDefined();
  });

  it('should clear a pending entry when its finalized counterpart arrives via gotFinalized', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryCommonSchema, mergeEntries);

    await storage.gotPending(txRef(['first-id', 'second-id']), new Date(0));
    expect(await storage.get('first-id')).toBeDefined();

    await storage.gotFinalized(finalizedInput('chain-hash', { identifiers: ['first-id', 'second-id', 'extra-id'] }));

    expect(await storage.get('first-id')).toBeUndefined();
    expect(await storage.get('chain-hash')).toBeDefined();
  });

  it('should transition a pending entry to rejected via gotRejected', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryCommonSchema, mergeEntries);

    await storage.gotPending(txRef(['first-id']), new Date(0));

    const rejectedAt = new Date('2026-01-02T00:00:00.000Z');
    await storage.gotRejected(txRef(['first-id']), rejectedAt, 'TTL expired');

    const result = await storage.get('first-id');

    expect(result?.lifecycle).toEqual({ status: 'rejected', rejectedAt, reason: 'TTL expired' });
  });
});
