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
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { expect } from 'vitest';
import { type WalletEntry } from '@midnightntwrk/wallet-sdk-facade';

function expectValidUnshieldedUtxoFields(utxo: NonNullable<WalletEntry['unshielded']>['createdUtxos'][number]) {
  expect(typeof utxo.value).toBe('bigint');
  expect(typeof utxo.owner).toBe('string');
  expect(typeof utxo.tokenType).toBe('string');
  expect(typeof utxo.intentHash).toBe('string');
  expect(typeof utxo.outputIndex).toBe('number');
}

export function expectValidShieldedCoinFields(coin: NonNullable<WalletEntry['shielded']>['receivedCoins'][number]) {
  expect(typeof coin.type).toBe('string');
  expect(coin.type.length).toBeGreaterThan(0);
  expect(typeof coin.nonce).toBe('string');
  expect(coin.nonce.length).toBeGreaterThan(0);
  expect(typeof coin.value).toBe('bigint');
  expect(typeof coin.mtIndex).toBe('bigint');
}

export function expectValidShieldedTxHistoryEntry(entry: WalletEntry) {
  expect(entry.shielded).toBeDefined();
  expect(Array.isArray(entry.shielded!.receivedCoins)).toBe(true);
  expect(Array.isArray(entry.shielded!.spentCoins)).toBe(true);
  for (const coin of [...entry.shielded!.receivedCoins, ...entry.shielded!.spentCoins]) {
    expectValidShieldedCoinFields(coin);
  }
}

export function expectValidUnshieldedTxHistoryEntry(entry: WalletEntry) {
  expect(entry.unshielded).toBeDefined();
  expect(Array.isArray(entry.unshielded!.createdUtxos)).toBe(true);
  expect(Array.isArray(entry.unshielded!.spentUtxos)).toBe(true);
  for (const utxo of [...entry.unshielded!.createdUtxos, ...entry.unshielded!.spentUtxos]) {
    expectValidUnshieldedUtxoFields(utxo);
  }
}

/** Asserts a sender's shielded tx history entry has valid spentCoins. */
export function expectSenderShieldedTxHistory(entry: WalletEntry) {
  expect(entry.shielded).toBeDefined();
  expect(entry.shielded!.spentCoins.length).toBeGreaterThan(0);
  expectValidShieldedTxHistoryEntry(entry);
}

/**
 * Asserts a receiver's shielded tx history entry has valid receivedCoins, and that a coin matching the expected value
 * exists with valid fields.
 */
export function expectReceiverShieldedTxHistory(entry: WalletEntry, expectedValue: bigint) {
  expect(entry.shielded).toBeDefined();
  expect(entry.shielded!.receivedCoins.length).toBeGreaterThan(0);
  const receivedCoin = entry.shielded!.receivedCoins.find((c) => c.value === expectedValue);
  expect(receivedCoin).toBeDefined();
  expectValidShieldedCoinFields(receivedCoin!);
  expectValidShieldedTxHistoryEntry(entry);
}

/** Asserts a sender's unshielded tx history entry has valid spentUtxos. */
export function expectSenderUnshieldedTxHistory(entry: WalletEntry) {
  expect(entry.unshielded).toBeDefined();
  expect(entry.unshielded!.spentUtxos.length).toBeGreaterThan(0);
  expectValidUnshieldedTxHistoryEntry(entry);
}

/**
 * Asserts a receiver's unshielded tx history entry has valid createdUtxos, and that a UTXO matching the expected value
 * exists with valid fields.
 */
export function expectReceiverUnshieldedTxHistory(entry: WalletEntry, expectedValue: bigint) {
  expect(entry.unshielded).toBeDefined();
  expect(entry.unshielded!.createdUtxos.length).toBeGreaterThan(0);
  const receivedUtxo = entry.unshielded!.createdUtxos.find((u) => u.value === expectedValue);
  expect(receivedUtxo).toBeDefined();
  expectValidUnshieldedUtxoFields(receivedUtxo!);
  expectValidUnshieldedTxHistoryEntry(entry);
}

/**
 * Asserts that tx history entries from a storage contain at least one entry with the specified section ('shielded' or
 * 'unshielded').
 */
export async function expectTxHistoryHasSection(
  storage: { getAll(): Promise<readonly Record<string, unknown>[]> },
  section: 'shielded' | 'unshielded',
) {
  const entries = await storage.getAll();
  expect(entries.length).toBeGreaterThan(0);
  const matching = entries.filter((e) => e[section] !== undefined);
  expect(matching.length).toBeGreaterThan(0);
  return entries;
}
