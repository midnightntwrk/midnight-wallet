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

export const SignatureMarker = {
  signature: 'signature',
  signatureErased: 'signature-erased',
} as const;

export const ProofMarker = {
  proof: 'proof',
  preProof: 'pre-proof',
  noProof: 'no-proof',
} as const;

export const BindingMarker = {
  binding: 'binding',
  preBinding: 'pre-binding',
  noBinding: 'no-binding',
} as const;

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

export const calculatePrefixLength = (anonymityLevel: number, totalItems: number, maxLength: number): number => {
  const itemPower = totalItems <= 0 ? 1 : Math.round(Math.log2(totalItems));
  const rawLength = Math.max(0, itemPower - anonymityLevel);

  // as we work with hex values, we need to ensure the length is even
  const evenLength = rawLength % 2 === 1 ? rawLength - 1 : rawLength;

  // force it to be between 2 (indexer's min length) and maxLength
  return Math.min(maxLength, Math.max(2, evenLength));
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
