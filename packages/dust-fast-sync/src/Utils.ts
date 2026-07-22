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
import { HashMap, HashSet, Option } from 'effect';
import { ScaleBigInt } from '@midnightntwrk/wallet-sdk-address-format';

export const hashMapGroupBy = <K, V>(arr: ReadonlyArray<V>, keyFn: (v: V) => K): HashMap.HashMap<K, V[]> =>
  arr.reduce((map, v) => {
    const key = keyFn(v);
    return HashMap.set(
      map,
      key,
      Option.match(HashMap.get(map, key), {
        onNone: () => [v],
        onSome: (existing) => existing.concat(v),
      }),
    );
  }, HashMap.empty<K, V[]>());

export const leBigintToHex = (n: bigint, dropLengthPrefix: boolean = false): string => {
  const encoded = Buffer.from(ScaleBigInt.encode(n));
  const bytes = dropLengthPrefix ? encoded.subarray(1) : encoded; // drop the SCALE compact length-prefix byte
  return bytes.toString('hex');
};

// fixed-width little-endian hex, as the indexer encodes nullifiers and commitments ("32-byte little-endian form").
// SCALE compact encoding (leBigintToHex) is minimal-length and drops most-significant zero bytes, so it cannot be
// compared against the indexer's fixed-width values directly.
export const bigintToLeHex = (n: bigint, byteLength: number): string =>
  Array.from({ length: byteLength }, (_, i) =>
    Number((n >> BigInt(8 * i)) & 0xffn)
      .toString(16)
      .padStart(2, '0'),
  ).join('');

export const uniqueArray = <T>(arr: ReadonlyArray<T>): T[] => Array.from(HashSet.fromIterable(arr));

/**
 * Length (in HEX CHARACTERS) of the nullifier prefix to query the indexer with so it returns an anonymity set of
 * ~2^anonymityLevel out of a population of `totalItems` commitments, per the ledger dust.md "Wallet recovery" math: a
 * prefix of (log2(N) - anonymityLevel) BITS leaves a set of 2^anonymityLevel.
 *
 * BIT -> BYTE -> HEX-CHAR conversion: the indexer decodes each prefix with const_hex::decode, which accepts WHOLE BYTES
 * only (8 bits/step, 4 bits per hex char, so 2 hex chars per byte). The returned value is consumed as `.substring(0,
 * n)` on a hex string, hence it is a hex-char count and must be even.
 *
 * Rounding favours privacy: floor(log2(N)) under-estimates the population's entropy and floor(prefixBits/8) truncates
 * the byte count DOWN, so the realized prefix is never LONGER than ideal — a shorter prefix yields a LARGER anonymity
 * set, never dropping below 2^anonymityLevel.
 *
 * BYTE-GRANULARITY LIMITATION: because prefixes must be whole bytes and non-empty (min 1 byte = 2 hex chars), the exact
 * 2^anonymityLevel target cannot always be hit. Where the min-1-byte floor is binding (small or low-entropy
 * populations) it forces an 8-bit prefix that can make the realized set SMALLER than 2^anonymityLevel (e.g. N=2^14,
 * n=7: ideal 7 bits, floor forces 8 bits -> set 2^6=64 < 128). This is an unavoidable protocol constraint (the indexer
 * rejects empty prefixes) and is accepted.
 */
export const calculatePrefixLength = (anonymityLevel: number, totalItems: number, maxLength: number): number => {
  const populationBits = totalItems <= 1 ? 0 : Math.floor(Math.log2(totalItems));
  const prefixBits = Math.max(0, populationBits - anonymityLevel);

  const prefixBytes = Math.floor(prefixBits / 8);
  const idealHexChars = prefixBytes * 2;

  // clamp into [2, maxLength]; both bounds are even (min 1 byte, max = NULLIFIER_BYTE_LENGTH*2) so even-ness holds
  return Math.min(maxLength, Math.max(2, idealHexChars));
};

// The index ranges of [lastAppliedIndex + 1, maxIndex] left uncovered by the (sorted, ascending) skipIndexes.
export const gapRanges = (
  lastAppliedIndex: number,
  maxIndex: number,
  skipIndexes: ReadonlyArray<number>,
): { start: number; end: number }[] =>
  [lastAppliedIndex, ...skipIndexes]
    .map((boundary, i) => ({ start: boundary + 1, end: (skipIndexes.at(i) ?? maxIndex + 1) - 1 }))
    .filter(({ start, end }) => start <= end);
