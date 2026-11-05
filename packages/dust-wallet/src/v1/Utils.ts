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

/** Hex-encodes a value in SCALE compact form, which is how the indexer serializes a Merkle tree root. */
export const leBigintToHex = (n: bigint): string => Buffer.from(ScaleBigInt.encode(n)).toString('hex');

/** The commitment and generation tree roots of a Dust state, hex-encoded as the indexer reports a block's roots. */
export type DustTreeRoots = { readonly commitment: string; readonly generation: string };

/**
 * Reads a Dust state's tree roots in the indexer's encoding, so they compare directly with a block's reported roots.
 *
 * @param state The local Dust state.
 * @returns The two roots; an empty tree, which has no root, is the empty string.
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
