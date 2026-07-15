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
import { Schema } from 'effect';
import {
  type FinalizedEntryInput,
  type PendingEntryInput,
  type RejectedEntryInput,
  type TransactionHistoryEntryCommon,
  TransactionHistoryEntryCommonSchema,
  extendEntrySchema,
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

  it('should record a rejected entry without a reason when none is given', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    const rejectedAt = new Date('2026-01-02T00:00:00.000Z');
    await storage.gotRejected(rejectedInput('tx', ['id-a'], rejectedAt));

    const result = await storage.get('tx');

    // No `reason` key at all — not `reason: undefined`.
    expect(result?.lifecycle).toEqual({ status: 'rejected', rejectedAt });
  });
});

describe('InMemoryTransactionHistoryStorage clears pending entries precisely', () => {
  // gotFinalized clears a prior pending entry only when ALL of these hold: the finalized entry has identifiers, the
  // pending entry has identifiers, the pending entry's identifiers are a SUBSET of the finalized set, and the entry is
  // actually pending (and not the just-written one). The happy-path superset case is covered above; these lock in each
  // remaining condition, since the clearing predicate is the riskiest surface in the storage.

  it('does not clear a pending entry when the finalized identifiers only partially overlap', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    await storage.gotPending(pendingInput('p1', ['id-a', 'id-b']));
    // Shares id-a but not id-b, so the pending entry is not fully contained and must survive.
    await storage.gotFinalized(finalizedInput('chain-hash', { identifiers: ['id-a', 'id-c'] }));

    expect(await storage.get('p1')).toBeDefined();
  });

  it('does not clear any pending entry when the finalized entry has no identifiers', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    await storage.gotPending(pendingInput('p1', ['id-a']));
    await storage.gotFinalized(finalizedInput('chain-hash', { identifiers: [] }));

    expect(await storage.get('p1')).toBeDefined();
  });

  it('never clears a pending entry that itself has no identifiers (guards against a vacuous match)', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    // `[].every(...)` is vacuously true; the length>0 guard must stop an empty-identifier pending being wrongly cleared.
    await storage.gotPending(pendingInput('p-empty', []));
    await storage.gotFinalized(finalizedInput('chain-hash', { identifiers: ['id-a'] }));

    expect(await storage.get('p-empty')).toBeDefined();
  });

  it('only clears pending entries, leaving a finalized sibling with overlapping identifiers intact', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    await storage.gotFinalized(finalizedInput('k1', { identifiers: ['id-a'] }));
    await storage.gotFinalized(finalizedInput('k2', { identifiers: ['id-a'] }));

    // k1 must not be deleted by k2's finalize — clearing targets pending entries only.
    expect(await storage.get('k1')).toBeDefined();
    expect(await storage.get('k2')).toBeDefined();
  });

  it('does NOT clear a cross-keyed pending entry on gotRejected (unlike gotFinalized)', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    // Pending under a fallback key; a rejected entry arrives under a different key whose identifiers superset it.
    // In the facade, submit and revert share one `txHistoryHash`, so a real revert re-keys the entry in place — this
    // documents that the storage method itself does not clear by identifier (the deliberate asymmetry with finalize).
    await storage.gotPending(pendingInput('first-id', ['first-id', 'second-id']));
    await storage.gotRejected(rejectedInput('chain-hash', ['first-id', 'second-id', 'extra-id'], new Date(0)));

    expect(await storage.get('first-id')).toBeDefined();
    expect((await storage.get('chain-hash'))?.lifecycle.status).toBe('rejected');
  });
});

describe('InMemoryTransactionHistoryStorage serialize / restore', () => {
  it('round-trips pending, finalized and rejected entries including their Date fields', async () => {
    const storage = new InMemoryTransactionHistoryStorage(TransactionHistoryEntryCommonSchema, mergeEntries);

    const submittedAt = new Date('2026-01-01T00:00:00.000Z');
    const finalizedBlock = { hash: 'b1', height: 7, timestamp: new Date('2026-02-01T00:00:00.000Z') };
    const rejectedAt = new Date('2026-03-01T00:00:00.000Z');

    await storage.gotPending(pendingInput('pending-tx', ['id-p'], submittedAt));
    await storage.gotFinalized(finalizedInput('finalized-tx', { identifiers: ['id-f'], finalizedBlock }));
    await storage.gotRejected(rejectedInput('rejected-tx', ['id-r'], rejectedAt, 'TTL expired'));

    const serialized = await storage.serialize();
    const restored = InMemoryTransactionHistoryStorage.restore(
      serialized,
      TransactionHistoryEntryCommonSchema,
      mergeEntries,
    );

    expect(await restored.get('pending-tx')).toEqual(await storage.get('pending-tx'));
    expect(await restored.get('finalized-tx')).toEqual(await storage.get('finalized-tx'));
    expect(await restored.get('rejected-tx')).toEqual(await storage.get('rejected-tx'));
  });
});

describe('extendEntrySchema', () => {
  it('combines the common entry fields with the extension and round-trips the extension section', async () => {
    const SectionSchema = Schema.Struct({ note: Schema.String });
    const ExtendedSchema = extendEntrySchema({ extra: Schema.optional(SectionSchema) });
    const merge = (
      existing: Schema.Schema.Type<typeof ExtendedSchema>,
      incoming: Schema.Schema.Type<typeof ExtendedSchema>,
    ): Schema.Schema.Type<typeof ExtendedSchema> => ({ ...existing, ...incoming });

    const storage = new InMemoryTransactionHistoryStorage(ExtendedSchema, merge);
    await storage.gotFinalized({
      hash: 'tx',
      identifiers: ['id-a'],
      finalizedBlock: { hash: 'block-hash', height: 0, timestamp: new Date(0) },
      extra: { note: 'hello' },
    });

    const result = await storage.get('tx');
    expect(result?.hash).toBe('tx'); // common field preserved
    expect(result?.extra).toEqual({ note: 'hello' }); // extension field preserved

    // The extension field survives a serialize/restore cycle too.
    const restored = InMemoryTransactionHistoryStorage.restore(await storage.serialize(), ExtendedSchema, merge);
    expect(await restored.get('tx')).toEqual(result);
  });
});
