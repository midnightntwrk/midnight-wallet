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

import { describe, it } from '@vitest/runner';
import { expect } from 'vitest';
import { bigintToLeHex, calculatePrefixLength, gapRanges, leBigintToHex } from '../src/v1/Utils.js';
import { LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';

describe('Utils', () => {
  it('calculatePrefixLength()', () => {
    const maxLength = 64; // 12bdf27706a2994ad7f214d5653bb44546afe1fedadda5219c8ba4fe90f23f44
    const nullifier = LedgerOps.generateHex(maxLength);
    // 0 means no privacy, no overhead (anonymity set equals 2**0 = 1)
    // 7 means 64x overhead, as well as 64 size of the anonymity set (62 additional values expected per query)
    expect(nullifier.substring(0, calculatePrefixLength(0, 1000, maxLength)).length).toBe(10);
    expect(nullifier.substring(0, calculatePrefixLength(1, 1000, maxLength)).length).toBe(8);
    expect(nullifier.substring(0, calculatePrefixLength(2, 1000, maxLength)).length).toBe(8);
    expect(nullifier.substring(0, calculatePrefixLength(3, 1000, maxLength)).length).toBe(6);
    expect(nullifier.substring(0, calculatePrefixLength(4, 1000, maxLength)).length).toBe(6);
    expect(nullifier.substring(0, calculatePrefixLength(5, 1000, maxLength)).length).toBe(4);
    expect(nullifier.substring(0, calculatePrefixLength(6, 1000, maxLength)).length).toBe(4);
    expect(nullifier.substring(0, calculatePrefixLength(7, 1000, maxLength)).length).toBe(2);
  });

  describe('bigintToLeHex()', () => {
    it('encodes little-endian at a fixed width', () => {
      expect(bigintToLeHex(1n, 32)).toBe('01' + '00'.repeat(31));
      expect(bigintToLeHex(0n, 4)).toBe('00000000');
      expect(bigintToLeHex(0x0102n, 4)).toBe('02010000');
    });

    it('keeps the full width when the most significant byte is zero', () => {
      // A value < 2^248 loses its top byte under minimal-length (SCALE) encoding.
      // The indexer's nullifierLeBytes is fixed 32-byte LE, so the width must be preserved.
      const topByteZero = (1n << 240n) | 0xabn;
      const hex = bigintToLeHex(topByteZero, 32);
      expect(hex).toHaveLength(64);
      expect(hex.endsWith('0100')).toBe(true);
      expect(hex.startsWith('ab')).toBe(true);
      // the SCALE-based encoding drops the zero top byte for the same value
      expect(leBigintToHex(topByteZero, true)).toHaveLength(62);
    });

    it('matches the SCALE-based encoding, padded to full width', () => {
      const nullifier = BigInt('0x12bdf27706a2994ad7f214d5653bb44546afe1fedadda5219c8ba4fe90f23f44');
      expect(bigintToLeHex(nullifier, 32)).toBe(leBigintToHex(nullifier, true).padEnd(64, '0'));
    });
  });

  describe('gapRanges()', () => {
    it('covers the whole span when there is nothing to skip', () => {
      expect(gapRanges(42, 100, [])).toEqual([{ start: 43, end: 100 }]);
    });

    it('splits around skipped indexes, dropping empty ranges for consecutive skips', () => {
      // mirrors the worked example in loadCollapsedCommitments: skips at 43, 67, 68, 75
      expect(gapRanges(-1, 80, [43, 67, 68, 75])).toEqual([
        { start: 0, end: 42 },
        { start: 44, end: 66 },
        { start: 69, end: 74 },
        { start: 76, end: 80 },
      ]);
    });

    it('omits the leading range when the first skip is at the start', () => {
      expect(gapRanges(42, 100, [43])).toEqual([{ start: 44, end: 100 }]);
    });

    it('omits the trailing range when the last skip is at the end', () => {
      expect(gapRanges(-1, 100, [100])).toEqual([{ start: 0, end: 99 }]);
    });

    it('returns nothing when skips cover the whole span', () => {
      expect(gapRanges(41, 43, [42, 43])).toEqual([]);
    });
  });
});
