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

describe('Utils', () => {
  // calculatePrefixLength returns a HEX-CHARACTER count consumed as `.substring(0, prefixLength)` on a
  // nullifier hex string, then decoded by the indexer with const_hex::decode (WHOLE BYTES => even hex chars,
  // 4 bits/char, 8 bits/byte, non-empty => minimum 1 byte = 2 hex chars).
  //
  // To leave an anonymity set of 2^anonymityLevel out of a population of N commitments the on-wire prefix must
  // be (log2(N) - anonymityLevel) BITS. Both log2(N) and the bit->byte conversion round DOWN (floor) so the
  // realized prefix is never LONGER than ideal (shorter prefix => larger set => privacy-safe). The min-1-byte
  // floor is the single exception where the realized set can drop below 2^anonymityLevel (see the N=2^14, n=7
  // case below): an unavoidable non-empty-prefix protocol constraint.
  const maxLength = 64; // full nullifier hex width = NULLIFIER_BYTE_LENGTH * 2

  it('converts the ideal bit-length prefix down to whole-byte hex chars (ticket N=2^14, n=7)', () => {
    // floor(log2(16384))=14; prefixBits=max(0,14-7)=7; prefixBytes=floor(7/8)=0; idealHexChars=0 -> min-1-byte
    // floor clamps to 2 hex chars = 1 byte = 8-bit prefix. Realized set = 2^(14-8)=2^6=64 < requested 128:
    // the min-1-byte floor forces a prefix 1 bit LONGER than the ideal 7 bits (documented byte-granularity limit).
    // The BUG returns 6 (round(log2)-7 = 7 -> even 6 hex chars = 24-bit prefix -> set ~1, wallet linkable).
    expect(calculatePrefixLength(7, 16384, maxLength)).toBe(2);
  });

  it('hits the anonymity set exactly when the ideal bit-length lands on a byte boundary (N=2^14, n=6)', () => {
    // populationBits=14; prefixBits=8; prefixBytes=1; idealHexChars=2 -> 8-bit prefix. Realized set = 2^6 = 64.
    expect(calculatePrefixLength(6, 16384, maxLength)).toBe(2);
  });

  it('hits the anonymity set exactly for a larger population on a byte boundary (N=2^24, n=8)', () => {
    // populationBits=24; prefixBits=16; prefixBytes=2; idealHexChars=4 -> 16-bit prefix. Realized set = 2^8 = 256.
    expect(calculatePrefixLength(8, 16777216, maxLength)).toBe(4);
  });

  it('floors the byte count down, over-shooting the set (privacy-safe) when bits are not byte-aligned (N=2^24, n=7)', () => {
    // populationBits=24; prefixBits=17; prefixBytes=floor(17/8)=2; idealHexChars=4 -> 16-bit prefix.
    // Realized set = 2^(24-16)=2^8=256 >= requested 2^7=128: floor made the set LARGER, never smaller.
    expect(calculatePrefixLength(7, 16777216, maxLength)).toBe(4);
  });

  it('yields the full-selectivity prefix for n=0 (anonymity set of 1, N=2^24)', () => {
    // populationBits=24; prefixBits=24; prefixBytes=3; idealHexChars=6 -> 24-bit prefix. Realized set = 2^0 = 1.
    expect(calculatePrefixLength(0, 16777216, maxLength)).toBe(6);
  });

  it('always returns an even number of hex chars (whole bytes, so const_hex::decode accepts the prefix)', () => {
    const cases: ReadonlyArray<readonly [number, number]> = [
      [0, 16777216],
      [1, 16777216],
      [7, 16777216],
      [8, 16777216],
      [6, 16384],
      [7, 16384],
      [3, 1000],
      [4, 100],
      [0, 1],
      [100, 16384],
    ];
    expect(cases.every(([n, N]) => calculatePrefixLength(n, N, maxLength) % 2 === 0)).toBe(true);
  });

  it('never returns below the 2-hex-char (1-byte, non-empty) minimum, even for N<=1 / N<=0', () => {
    // N=0 -> maxCommitmentEndIndex can be -1; must never produce NaN/negative/odd. Floor to the safe 2-char min.
    expect(calculatePrefixLength(4, 0, maxLength)).toBe(2);
    expect(calculatePrefixLength(4, -1, maxLength)).toBe(2);
    expect(calculatePrefixLength(0, 1, maxLength)).toBe(2);
  });

  it('returns the minimum prefix when the requested set is larger than the population (n >> log2(N))', () => {
    // populationBits=14; prefixBits=max(0,14-100)=0 -> min-1-byte floor -> 2 hex chars. No negative/NaN.
    expect(calculatePrefixLength(100, 16384, maxLength)).toBe(2);
  });

  it('clamps down to maxLength when the ideal hex length would exceed it', () => {
    // N=2^24, n=0 -> idealHexChars=6, but maxLength=4 forces Math.min => 4.
    expect(calculatePrefixLength(0, 16777216, 4)).toBe(4);
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
