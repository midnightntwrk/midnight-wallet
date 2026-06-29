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
  let bytes = Buffer.from(ScaleBigInt.encode(n));
  if (dropLengthPrefix) {
    bytes = bytes.subarray(1); // drop the 0x73 prefix byte
  }
  const str = bytes.toString('hex');
  return str.length % 2 === 0 ? str : '0' + str;
};

export const uniqueArray = <T>(arr: ReadonlyArray<T>): T[] => Array.from(HashSet.fromIterable(arr));

export const calculatePrefixLength = (anonymityLevel: number, totalItems: number, maxLength: number) => {
  const itemPower = totalItems <= 0 ? 1 : Math.round(Math.log2(totalItems));
  let prefixLength = Math.max(0, itemPower - anonymityLevel);

  // as we work with hex values, we need to ensure the length is even
  prefixLength = prefixLength % 2 === 1 ? prefixLength - 1 : prefixLength;

  // force it to be between 2 (indexer's min length) and maxLength
  prefixLength = Math.min(maxLength, Math.max(2, prefixLength));

  return prefixLength;
};
