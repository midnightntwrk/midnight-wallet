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
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { type WalletEntry, WalletEntrySchema, mergeWalletEntries } from '../src/index.js';

const shieldedCoin = (type: string, nonce: string, value: bigint, mtIndex: bigint) => ({
  type,
  nonce,
  value,
  mtIndex,
});

const unshieldedUtxo = (value: bigint, owner: string, tokenType: string, intentHash: string, outputIndex: number) => ({
  value,
  owner,
  tokenType,
  intentHash,
  outputIndex,
});

const baseEntry = (hash: string, overrides: Partial<WalletEntry> = {}): WalletEntry => ({
  hash,
  protocolVersion: 1,
  status: 'SUCCESS',
  ...overrides,
});

describe('InMemoryTransactionHistoryStorage upsert respects the merge function', () => {
  it('should use the provided merge function when upserting an entry with the same hash', async () => {
    const storage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);

    const coinA = shieldedCoin('token-a', 'nonce-a', 100n, 1n);
    const coinB = shieldedCoin('token-b', 'nonce-b', 200n, 2n);

    await storage.upsert(
      baseEntry('tx1', {
        shielded: { receivedCoins: [coinA], spentCoins: [] },
      }),
    );

    await storage.upsert(
      baseEntry('tx1', {
        shielded: { receivedCoins: [coinB], spentCoins: [] },
      }),
    );

    const result = await storage.get('tx1');

    expect(result?.shielded?.receivedCoins).toHaveLength(2);
    expect(result?.shielded?.receivedCoins).toEqual(expect.arrayContaining([coinA, coinB]));
  });

  it('should insert without merging when no prior entry exists for that hash', async () => {
    const storage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);

    const coin = shieldedCoin('token-a', 'nonce-a', 100n, 1n);

    await storage.upsert(
      baseEntry('tx1', {
        shielded: { receivedCoins: [coin], spentCoins: [] },
      }),
    );

    const result = await storage.get('tx1');

    expect(result?.shielded?.receivedCoins).toEqual([coin]);
  });

  it('should keep entries with different hashes independent', async () => {
    const storage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);

    const coinA = shieldedCoin('token-a', 'nonce-a', 100n, 1n);
    const coinB = shieldedCoin('token-b', 'nonce-b', 200n, 2n);

    await storage.upsert(
      baseEntry('tx1', {
        shielded: { receivedCoins: [coinA], spentCoins: [] },
      }),
    );

    await storage.upsert(
      baseEntry('tx2', {
        shielded: { receivedCoins: [coinB], spentCoins: [] },
      }),
    );

    const result1 = await storage.get('tx1');
    const result2 = await storage.get('tx2');

    expect(result1?.shielded?.receivedCoins).toEqual([coinA]);
    expect(result2?.shielded?.receivedCoins).toEqual([coinB]);
  });
});

describe('mergeWalletEntries does not lose information', () => {
  it('should preserve shielded section from existing when incoming has only unshielded', () => {
    const coin = shieldedCoin('token-a', 'nonce-a', 100n, 1n);
    const utxo = unshieldedUtxo(50n, 'owner-1', 'night', 'intent-1', 0);

    const existing = baseEntry('tx1', {
      shielded: { receivedCoins: [coin], spentCoins: [] },
    });

    const incoming = baseEntry('tx1', {
      unshielded: { id: 1, createdUtxos: [utxo], spentUtxos: [] },
    });

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.shielded).toEqual({ receivedCoins: [coin], spentCoins: [] });
    expect(merged.unshielded).toEqual({ id: 1, createdUtxos: [utxo], spentUtxos: [] });
  });

  it('should preserve unshielded section from existing when incoming has only shielded', () => {
    const coin = shieldedCoin('token-a', 'nonce-a', 100n, 1n);
    const utxo = unshieldedUtxo(50n, 'owner-1', 'night', 'intent-1', 0);

    const existing = baseEntry('tx1', {
      unshielded: { id: 1, createdUtxos: [utxo], spentUtxos: [] },
    });

    const incoming = baseEntry('tx1', {
      shielded: { receivedCoins: [coin], spentCoins: [] },
    });

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.unshielded).toEqual({ id: 1, createdUtxos: [utxo], spentUtxos: [] });
    expect(merged.shielded).toEqual({ receivedCoins: [coin], spentCoins: [] });
  });

  it('should union shielded coins when both entries have shielded sections', () => {
    const coinA = shieldedCoin('token-a', 'nonce-a', 100n, 1n);
    const spentCoinA = shieldedCoin('token-s', 'nonce-s', 50n, 3n);
    const coinB = shieldedCoin('token-b', 'nonce-b', 200n, 2n);
    const spentCoinB = shieldedCoin('token-t', 'nonce-t', 75n, 4n);

    const existing = baseEntry('tx1', {
      shielded: { receivedCoins: [coinA], spentCoins: [spentCoinA] },
    });

    const incoming = baseEntry('tx1', {
      shielded: { receivedCoins: [coinB], spentCoins: [spentCoinB] },
    });

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.shielded?.receivedCoins).toHaveLength(2);
    expect(merged.shielded?.receivedCoins).toEqual(expect.arrayContaining([coinA, coinB]));
    expect(merged.shielded?.spentCoins).toHaveLength(2);
    expect(merged.shielded?.spentCoins).toEqual(expect.arrayContaining([spentCoinA, spentCoinB]));
  });

  it('should deduplicate identical shielded coins', () => {
    const coin = shieldedCoin('token-a', 'nonce-a', 100n, 1n);

    const existing = baseEntry('tx1', {
      shielded: { receivedCoins: [coin], spentCoins: [] },
    });

    const incoming = baseEntry('tx1', {
      shielded: { receivedCoins: [coin], spentCoins: [] },
    });

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.shielded?.receivedCoins).toHaveLength(1);
    expect(merged.shielded?.receivedCoins).toEqual([coin]);
  });

  it('should update common fields from incoming while preserving merged sections', () => {
    const coin = shieldedCoin('token-a', 'nonce-a', 100n, 1n);

    const existing = baseEntry('tx1', {
      status: 'FAILURE',
      shielded: { receivedCoins: [coin], spentCoins: [] },
    });

    const incoming = baseEntry('tx1', {
      status: 'SUCCESS',
      identifiers: ['id-1'],
      timestamp: new Date('2026-01-01'),
      fees: 1000n,
      shielded: { receivedCoins: [], spentCoins: [] },
    });

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.status).toBe('SUCCESS');
    expect(merged.identifiers).toEqual(['id-1']);
    expect(merged.timestamp).toEqual(new Date('2026-01-01'));
    expect(merged.fees).toBe(1000n);
    expect(merged.shielded?.receivedCoins).toEqual([coin]);
  });
});
