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
import { ScaleBigInt } from '@midnight-ntwrk/wallet-sdk-address-format';

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

export const upsertArrayMap = <K, V>(map: HashMap.HashMap<K, V[]>, key: K, val: V): HashMap.HashMap<K, V[]> =>
  HashMap.set(
    map,
    key,
    Option.match(HashMap.get(map, key), {
      onNone: () => [val],
      onSome: (arr) => arr.concat(val),
    }),
  );

// Little-endian hex, no length prefix
export const nullifierToHex = (n: bigint): string => {
  const bytes = Buffer.from(ScaleBigInt.encode(n)).slice(1); // drop the 0x73 prefix byte
  const str = bytes.toString('hex');
  return str.length % 2 === 0 ? str : '0' + str;
};

export const uniqueArray = <T>(arr: ReadonlyArray<T>): T[] => Array.from(HashSet.fromIterable(arr));
