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
import { type DustLocalState } from '@midnight-ntwrk/ledger-v8';
import { ScaleBigInt } from '@midnightntwrk/wallet-sdk-address-format';
import { type DustTreeRoots } from '../SpendTime.js';

export type { DustTreeRoots } from '../SpendTime.js';

/**
 * Hex-encodes a value in SCALE compact form, which is how the indexer serializes a Merkle tree root.
 *
 * @param n The value to encode.
 * @param dropLengthPrefix Whether to drop the leading SCALE compact length-prefix byte.
 * @returns The hex encoding.
 */
export const leBigintToHex = (n: bigint, dropLengthPrefix: boolean = false): string => {
  const encoded = Buffer.from(ScaleBigInt.encode(n));
  return (dropLengthPrefix ? encoded.subarray(1) : encoded).toString('hex');
};

/**
 * Reads a Dust state's tree roots in the indexer's encoding, so they compare directly with a block's reported roots.
 *
 * @param state The local Dust state.
 * @returns The two roots. An empty tree has root `0n`, so it reads as `'00'`; the empty string stands for a root the
 *   ledger did not give.
 */
export const dustTreeRoots = (state: DustLocalState): DustTreeRoots => {
  const commitment = state.commitmentTreeRoot();
  const generation = state.generatingTreeRoot();
  return {
    commitment: commitment === undefined ? '' : leBigintToHex(commitment),
    generation: generation === undefined ? '' : leBigintToHex(generation),
  };
};

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
