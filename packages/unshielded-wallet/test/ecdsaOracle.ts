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
import type { Signature, SignatureVerifyingKey } from '@midnightntwrk/ledger-v9';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';

const toBytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'));

/**
 * Independent signature-verification oracle for unshielded-wallet tests.
 *
 * Verifying wallet-produced signatures with `@noble/curves` (a different implementation from the ledger that produced
 * them) keeps signatures from being self-attested by the library under test.
 *
 * Behaviour confirmed against `@midnightntwrk/ledger-v9@0.1.0-alpha.1`: the ledger signs `sha256(data)` under both
 * schemes —
 *
 * - `schnorr`: BIP-340 over secp256k1, 32-byte x-only verifying key;
 * - `ecdsa`: secp256k1, 33-byte SEC1-compressed verifying key, 64-byte `r‖s`.
 *
 * A signature whose scheme tag differs from the verifying key's tag never verifies (the schemes are not
 * interchangeable).
 *
 * @example
 *   ```typescript
 *   const keystore = createKeystore({ kind: 'ecdsa', secret }, networkId);
 *   const sig = keystore.signData(data);
 *   expect(verifyWithOracle(keystore.getPublicKey(), data, sig)).toBe(true);
 *   ```;
 *
 * @param verifyingKey - The ledger verifying key (`{ tag, value }`, hex `value`).
 * @param data - The exact bytes that were passed to `signData` (unhashed).
 * @param signature - The ledger signature (`{ tag, value }`, hex `value`).
 * @returns `true` iff `signature` is a valid signature of `data` under `verifyingKey`.
 */
export const verifyWithOracle = (
  verifyingKey: SignatureVerifyingKey,
  data: Uint8Array,
  signature: Signature,
): boolean => {
  if (verifyingKey.tag !== signature.tag) {
    return false;
  }
  const digest = sha256(data);
  const publicKey = toBytes(verifyingKey.value);
  const rawSignature = toBytes(signature.value);
  return verifyingKey.tag === 'ecdsa'
    ? secp256k1.verify(rawSignature, digest, publicKey)
    : schnorr.verify(rawSignature, digest, publicKey);
};
