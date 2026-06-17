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
//
// Golden-vector regression locks for unshielded-wallet key/address/signature
// derivation (Schnorr + ECDSA), plus the independent @noble/curves oracle.
//
// The frozen vectors in fixtures/ecdsaVectors.json are produced by the real
// ledger-v9 + wallet-sdk-hd pipeline (regenerate with fixtures/generate.mjs).
// They pin the full chain: HD seed → role key → keystore → verifying key →
// address → signature. This catches any accidental change to derivation,
// encoding, or address formatting before — and after — ECDSA support lands.
//
// Determinism finding (confirmed against ledger-v9 0.1.0-alpha.1):
//   • ECDSA  — RFC-6979 deterministic ⇒ the signature itself is frozen.
//   • Schnorr — BIP-340 randomized nonce ⇒ NO stable signature to freeze;
//     `fixtures.schnorr.signature` is null and we verify via the oracle on
//     every run instead. (This corrects the original backlog assumption that a
//     Schnorr `signData` golden vector — ECDSA-BC-01 — could be byte-frozen.)
//
// Plan corrections encoded by these vectors:
//   • Derivation path (KD-01): the ECDSA vector uses HD role `EcdsaUnshielded`
//     (role 4, from ledger-v9 migration #455). This is the CURRENT path, not a
//     MIP-frozen one — if the MIP fixes a different path the ECDSA vectors must
//     be regenerated; a vector diff there is expected, not a regression.
//   • Address scheme (AD-01/AD-02): a Midnight address does NOT carry a scheme
//     tag or prefix — it is a plain hash. Schemes are distinguished by
//     domain-separated derivation (the ECDSA and Schnorr addresses simply
//     differ), and the scheme tag lives on the KEY (`{tag,value}`), not the
//     address. The tests below assert the address is derivable from the key and
//     that the two schemes' addresses are disjoint — not that the address
//     self-identifies its scheme.
import { readFileSync } from 'node:fs';
import * as ledger from '@midnight-ntwrk/ledger-v9';
import { HDWallet, type Role, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import { createKeystore, type UnshieldedKeystore } from '../src/KeyStore.js';
import { verifyWithOracle } from './ecdsaOracle.js';

type Vector = {
  kind: 'schnorr' | 'ecdsa';
  hdRole: number;
  privateKey: string;
  verifyingKey: string;
  verifyingKeyBytes: number;
  addressHex: string;
  bech32Address: string;
  signatureDeterministic: boolean;
  signature: string | null;
};
type Vectors = {
  networkId: string;
  derivation: { account: number; index: number; seedHex: string };
  message: { utf8: string };
  schnorr: Vector;
  ecdsa: Vector;
};

const vectors = JSON.parse(readFileSync(new URL('./fixtures/ecdsaVectors.json', import.meta.url), 'utf8')) as Vectors;

const networkId = NetworkId.NetworkId.Undeployed;
const seed = Buffer.from(vectors.derivation.seedHex, 'hex');
const data = new TextEncoder().encode(vectors.message.utf8);
const hexOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const deriveSecret = (role: number): Uint8Array => {
  const hdWalletResult = HDWallet.fromSeed(seed);
  if (hdWalletResult.type !== 'seedOk') {
    throw new Error('seed initialisation failed');
  }
  const result = hdWalletResult.hdWallet
    .selectAccount(vectors.derivation.account)
    .selectRole(role as Role)
    .deriveKeyAt(vectors.derivation.index);
  if (result.type !== 'keyDerived') {
    throw new Error(`derivation failed for role ${role}`);
  }
  return result.key;
};

const keystoreFor = (vector: Vector): UnshieldedKeystore =>
  createKeystore({ kind: vector.kind, secret: deriveSecret(vector.hdRole) }, networkId);

describe('golden vectors — derivation, address & signature (Schnorr + ECDSA)', () => {
  it.each([
    { id: 'schnorr', vector: vectors.schnorr, role: Roles.NightExternal, bytes: 32 },
    { id: 'ecdsa', vector: vectors.ecdsa, role: Roles.EcdsaUnshielded, bytes: 33 },
  ])('$id: HD seed → role key matches the frozen vector', ({ vector, role }) => {
    // Sanity: the fixture's role matches the canonical role for this scheme.
    expect(vector.hdRole).toBe(role);
    expect(hexOf(deriveSecret(vector.hdRole))).toBe(vector.privateKey);
  });

  it.each([
    { id: 'schnorr', vector: vectors.schnorr },
    { id: 'ecdsa', vector: vectors.ecdsa },
  ])('$id: verifying key, address & bech32 match the frozen vector', ({ vector }) => {
    const keystore = keystoreFor(vector);
    const verifyingKey = keystore.getPublicKey();

    expect(verifyingKey.tag).toBe(vector.kind);
    expect(verifyingKey.value).toBe(vector.verifyingKey);
    expect(verifyingKey.value.length / 2).toBe(vector.verifyingKeyBytes);
    expect(keystore.getAddress()).toBe(vector.addressHex);
    expect(keystore.getBech32Address().asString()).toBe(vector.bech32Address);
  });

  it.each([
    { id: 'schnorr', vector: vectors.schnorr },
    { id: 'ecdsa', vector: vectors.ecdsa },
  ])('$id: a signature verifies via the independent oracle and the ledger', ({ vector }) => {
    const keystore = keystoreFor(vector);
    const signature = keystore.signData(data);

    expect(signature.tag).toBe(vector.kind);
    expect(verifyWithOracle(keystore.getPublicKey(), data, signature)).toBe(true);
    expect(ledger.verifySignature(keystore.getPublicKey(), data, signature)).toBe(true);
  });

  describe('ECDSA — RFC-6979 deterministic (signature is frozen)', () => {
    it('signing is byte-stable and matches the frozen signature vector', () => {
      const keystore = keystoreFor(vectors.ecdsa);
      const first = keystore.signData(data);
      const second = keystore.signData(data);

      expect(vectors.ecdsa.signatureDeterministic).toBe(true);
      expect(first.value).toBe(second.value);
      expect(first.value).toBe(vectors.ecdsa.signature);
      expect(first.value.length / 2).toBe(64); // raw r‖s, not DER
    });
  });

  describe('Schnorr — BIP-340 randomized (no frozen signature)', () => {
    it('no signature is pinned; two signings differ yet both verify', () => {
      const keystore = keystoreFor(vectors.schnorr);
      const verifyingKey = keystore.getPublicKey();
      const first = keystore.signData(data);
      const second = keystore.signData(data);

      expect(vectors.schnorr.signatureDeterministic).toBe(false);
      expect(vectors.schnorr.signature).toBeNull();
      expect(first.value).not.toBe(second.value); // randomized nonce
      expect(verifyWithOracle(verifyingKey, data, first)).toBe(true);
      expect(verifyWithOracle(verifyingKey, data, second)).toBe(true);
    });
  });

  describe('oracle rejects what it must (negative controls)', () => {
    const schnorrKeystore = keystoreFor(vectors.schnorr);
    const ecdsaKeystore = keystoreFor(vectors.ecdsa);
    const schnorrSig = schnorrKeystore.signData(data);
    const ecdsaSig = ecdsaKeystore.signData(data);

    it('rejects a cross-scheme signature', () => {
      expect(verifyWithOracle(ecdsaKeystore.getPublicKey(), data, schnorrSig)).toBe(false);
      expect(verifyWithOracle(schnorrKeystore.getPublicKey(), data, ecdsaSig)).toBe(false);
    });

    it('rejects a signature over tampered data', () => {
      const tampered = new TextEncoder().encode(`${vectors.message.utf8}!`);
      expect(verifyWithOracle(ecdsaKeystore.getPublicKey(), tampered, ecdsaSig)).toBe(false);
      expect(verifyWithOracle(schnorrKeystore.getPublicKey(), tampered, schnorrSig)).toBe(false);
    });
  });
});
