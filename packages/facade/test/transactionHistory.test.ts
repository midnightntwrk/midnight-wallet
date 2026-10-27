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
import { InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { type FinalizedWalletEntry, type WalletEntry, WalletEntrySchema, mergeWalletEntries } from '../src/index.js';

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

const baseEntry = (hash: string, overrides: Partial<FinalizedWalletEntry> = {}): FinalizedWalletEntry => ({
  hash,
  identifiers: [],
  protocolVersion: 1,
  status: 'SUCCESS',
  lifecycle: {
    status: 'finalized',
    finalizedBlock: { hash: 'block-hash', height: 0, timestamp: new Date(0) },
  },
  ...overrides,
});

const pendingEntry = (hash: string, overrides: Partial<WalletEntry> = {}): WalletEntry => ({
  hash,
  identifiers: [],
  protocolVersion: 1,
  lifecycle: { status: 'pending', submittedAt: new Date(0) },
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

  it('should preserve shared scalar fields from existing (first writer wins) and merge sections', () => {
    // Shared facts about the tx (status/timestamp/fees/protocolVersion) are the same across all wallets observing
    // it. Once any wallet has set them, later writes are no-ops for those fields. This test asserts that
    // first-writer-wins semantics — except for `identifiers`, which is unioned, and `lifecycle`, where incoming wins
    // (to record state transitions).
    const coin = shieldedCoin('token-a', 'nonce-a', 100n, 1n);

    const existing = baseEntry('tx1', {
      status: 'FAILURE',
      identifiers: ['id-existing'],
      timestamp: new Date('2026-01-01'),
      fees: 500n,
      shielded: { receivedCoins: [coin], spentCoins: [] },
    });

    const incoming = baseEntry('tx1', {
      status: 'SUCCESS',
      identifiers: ['id-incoming'],
      timestamp: new Date('2026-02-01'),
      fees: 1000n,
      shielded: { receivedCoins: [], spentCoins: [] },
    });

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.status).toBe('FAILURE'); // first writer wins
    expect(merged.identifiers).toEqual(['id-existing', 'id-incoming']); // unioned
    expect(merged.timestamp).toEqual(new Date('2026-01-01')); // first writer wins
    expect(merged.fees).toBe(500n); // first writer wins
    expect(merged.shielded?.receivedCoins).toEqual([coin]); // sections combined
  });

  it('should fill in shared scalar fields from incoming when existing has them undefined', () => {
    // Pending → finalized: the pending entry has no status/timestamp/fees yet, so the finalized write fills them.
    const existing = baseEntry('tx1', { status: undefined, timestamp: undefined, fees: undefined });

    const incoming = baseEntry('tx1', {
      status: 'SUCCESS',
      timestamp: new Date('2026-01-01'),
      fees: 1000n,
    });

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.status).toBe('SUCCESS');
    expect(merged.timestamp).toEqual(new Date('2026-01-01'));
    expect(merged.fees).toBe(1000n);
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

  it('should overwrite (not union) the unshielded section when both entries have one', () => {
    // Unlike shielded/dust (which union + dedup), unshielded sections merge by overwrite: an unshielded update always
    // carries the complete UTxO set for the tx, so the incoming section fully replaces the existing one.
    const utxoA = unshieldedUtxo(50n, 'owner-1', 'night', 'intent-1', 0);
    const utxoB = unshieldedUtxo(70n, 'owner-2', 'night', 'intent-2', 1);

    const existing = baseEntry('tx1', {
      unshielded: { id: 1, createdUtxos: [utxoA], spentUtxos: [] },
    });

    const incoming = baseEntry('tx1', {
      unshielded: { id: 2, createdUtxos: [utxoB], spentUtxos: [] },
    });

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.unshielded).toEqual({ id: 2, createdUtxos: [utxoB], spentUtxos: [] });
  });

  it('should keep the fields neither entry declares, incoming winning a shared name, so a later release finds them after any update', () => {
    // A storage that keeps fields this build does not know on the entry value hands them to the merge, and a merge is
    // how every later write to the same transaction lands, so dropping them here loses them as surely as a reader
    // ignoring them.
    const existing: WalletEntry = {
      ...pendingEntry('tx1'),
      ...{ onlyOnExisting: { kept: true }, onBoth: 'existing' },
    };
    const incoming: WalletEntry = {
      ...baseEntry('tx1', { status: 'SUCCESS' }),
      ...{ onlyOnIncoming: [1, 2], onBoth: 'incoming' },
    };

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged).toMatchObject({ onlyOnExisting: { kept: true }, onlyOnIncoming: [1, 2], onBoth: 'incoming' });
    expect(merged.lifecycle.status).toBe('finalized');
    expect(merged.status).toBe('SUCCESS');
  });
});

describe('mergeWalletEntries records lifecycle transitions', () => {
  it('preserves finalized inclusion over a late rejection', () => {
    const existing = baseEntry('tx1');
    const incoming: WalletEntry = {
      hash: 'tx1',
      identifiers: [],
      lifecycle: { status: 'rejected', rejectedAt: new Date(), reason: 'orphaned-by-protocol-upgrade' },
    };
    expect(mergeWalletEntries(existing, incoming).lifecycle).toEqual(existing.lifecycle);
    expect(mergeWalletEntries(incoming, existing).lifecycle).toEqual(existing.lifecycle);
  });
  it('should transition a pending entry to finalized when its finalized counterpart arrives', () => {
    const existing = pendingEntry('tx1');
    const incoming = baseEntry('tx1'); // finalized

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.lifecycle.status).toBe('finalized');
  });

  it('preserves the existing behavior of explicitly writing pending over finalized', () => {
    const existing = baseEntry('tx1'); // finalized
    const incoming = pendingEntry('tx1');

    const merged = mergeWalletEntries(existing, incoming);

    expect(merged.lifecycle.status).toBe('pending');
  });
});

describe('a restored history keeps an entry field it does not know through a later update', () => {
  const UNKNOWN_KEY = 'fieldFromALaterRelease';
  const UNKNOWN_VALUE = { kept: ['exactly', 'as', 'written'], nested: { flag: true } };

  const isJsonObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  const parseEnvelope = (serialized: string): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(serialized);
    if (!isJsonObject(parsed)) throw new Error('expected a transaction history envelope');
    return parsed;
  };

  const entriesOf = (envelope: Record<string, unknown>): readonly Record<string, unknown>[] => {
    const entries = envelope['entries'];
    if (!Array.isArray(entries)) throw new Error('expected a transaction history envelope with entries');
    return entries.filter(isJsonObject);
  };

  it('should carry the field when a pending entry is finalized, so a later release reading the history back still finds it', async () => {
    const writer = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
    await writer.gotPending({ hash: 'tx1', identifiers: ['id-1'], protocolVersion: 1, submittedAt: new Date(0) });
    const saved = parseEnvelope(await writer.serialize());
    const withUnknownField = JSON.stringify({
      ...saved,
      entries: entriesOf(saved).map((entry) => ({ ...entry, [UNKNOWN_KEY]: UNKNOWN_VALUE })),
    });

    const restored = InMemoryTransactionHistoryStorage.restore(withUnknownField, WalletEntrySchema, mergeWalletEntries);
    await restored.gotFinalized({
      hash: 'tx1',
      identifiers: ['id-1'],
      protocolVersion: 1,
      status: 'SUCCESS',
      finalizedBlock: { hash: 'block-hash', height: 1, timestamp: new Date(1) },
    });

    const written = entriesOf(parseEnvelope(await restored.serialize()));
    expect(written.map((entry) => [entry['hash'], entry[UNKNOWN_KEY]])).toEqual([['tx1', UNKNOWN_VALUE]]);
    expect(written.map((entry) => entry['lifecycle'])).toMatchObject([{ status: 'finalized' }]);
  });
});
