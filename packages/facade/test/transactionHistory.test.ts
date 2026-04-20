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
import { type WalletEntry, mergeWalletEntries } from '../src/index.js';

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

const dustUtxo = (initialValue: bigint, nonce: bigint, seq: number, backingNight: string, mtIndex: bigint) => ({
  initialValue,
  nonce,
  seq,
  backingNight,
  mtIndex,
});

const baseEntry = (hash: string, overrides: Partial<WalletEntry> = {}): WalletEntry => ({
  hash,
  protocolVersion: 1,
  status: 'SUCCESS',
  ...overrides,
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

    expect(merged.shielded?.receivedCoins).toEqual([coinA, coinB]);
    expect(merged.shielded?.spentCoins).toEqual([spentCoinA, spentCoinB]);
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

  it('should preserve dust section from existing when incoming has only shielded', () => {
    const dust = dustUtxo(500n, 1n, 0, 'night-1', 10n);
    const coin = shieldedCoin('token-a', 'nonce-a', 100n, 1n);

    const existing = baseEntry('tx1', {
      dust: { receivedUtxos: [dust], spentUtxos: [] },
    });

    const incoming = baseEntry('tx1', {
      shielded: { receivedCoins: [coin], spentCoins: [] },
    });

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.dust).toEqual({ receivedUtxos: [dust], spentUtxos: [] });
    expect(merged.shielded).toEqual({ receivedCoins: [coin], spentCoins: [] });
  });

  it('should preserve shielded section from existing when incoming has only dust', () => {
    const coin = shieldedCoin('token-a', 'nonce-a', 100n, 1n);
    const dust = dustUtxo(500n, 1n, 0, 'night-1', 10n);

    const existing = baseEntry('tx1', {
      shielded: { receivedCoins: [coin], spentCoins: [] },
    });

    const incoming = baseEntry('tx1', {
      dust: { receivedUtxos: [dust], spentUtxos: [] },
    });

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.shielded).toEqual({ receivedCoins: [coin], spentCoins: [] });
    expect(merged.dust).toEqual({ receivedUtxos: [dust], spentUtxos: [] });
  });

  it('should union dust utxos when both entries have dust sections', () => {
    const dustA = dustUtxo(500n, 1n, 0, 'night-1', 10n);
    const spentDustA = dustUtxo(300n, 2n, 1, 'night-2', 11n);
    const dustB = dustUtxo(700n, 3n, 0, 'night-3', 12n);
    const spentDustB = dustUtxo(400n, 4n, 1, 'night-4', 13n);

    const existing = baseEntry('tx1', {
      dust: { receivedUtxos: [dustA], spentUtxos: [spentDustA] },
    });

    const incoming = baseEntry('tx1', {
      dust: { receivedUtxos: [dustB], spentUtxos: [spentDustB] },
    });

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.dust?.receivedUtxos).toEqual([dustA, dustB]);
    expect(merged.dust?.spentUtxos).toEqual([spentDustA, spentDustB]);
  });

  it('should deduplicate identical dust utxos', () => {
    const dust = dustUtxo(500n, 1n, 0, 'night-1', 10n);

    const existing = baseEntry('tx1', {
      dust: { receivedUtxos: [dust], spentUtxos: [] },
    });

    const incoming = baseEntry('tx1', {
      dust: { receivedUtxos: [dust], spentUtxos: [] },
    });

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.dust?.receivedUtxos).toEqual([dust]);
  });

  it('should preserve all three sections across merges', () => {
    const coin = shieldedCoin('token-a', 'nonce-a', 100n, 1n);
    const utxo = unshieldedUtxo(50n, 'owner-1', 'night', 'intent-1', 0);
    const dust = dustUtxo(500n, 1n, 0, 'night-1', 10n);

    const existing = baseEntry('tx1', {
      shielded: { receivedCoins: [coin], spentCoins: [] },
      unshielded: { id: 1, createdUtxos: [utxo], spentUtxos: [] },
    });

    const incoming = baseEntry('tx1', {
      dust: { receivedUtxos: [dust], spentUtxos: [] },
    });

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.shielded).toEqual({ receivedCoins: [coin], spentCoins: [] });
    expect(merged.unshielded).toEqual({ id: 1, createdUtxos: [utxo], spentUtxos: [] });
    expect(merged.dust).toEqual({ receivedUtxos: [dust], spentUtxos: [] });
  });
});
