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
// ECDSA-MM — Scheme-mismatch rejection suite (midnight-wallet#402, AC #4).
//
// "Mismatches between signature kinds need to be rejected with clear error
// messages." This is the headline security acceptance criterion of #402: an
// unshielded wallet/address/key/signature carries an unambiguous scheme tag
// ('schnorr' | 'ecdsa'), and every incompatible combination must be rejected
// EARLY (at construction or signature provision) with a clear, typed error —
// never silently coerced, and never deferred to network submission.
//
// The guards under test live in `src/SchemeConsistency.ts`:
//   - assertKeyAddressConsistency — the stored address must derive from the stored key (MM-01/02);
//   - assertSignatureMatchesKey   — a supplied signature must share the key's scheme tag (MM-03/04/05).
// They are wired into signUnprovenTransaction/signUnboundTransaction (before a signature is attached)
// and onto the deserialization path; this suite exercises them directly. (A relabelled key whose
// encoding does not match its tag — the former MM-09 case — is rejected by assertKeyAddressConsistency
// when the ledger key decoder fails to decode it; see serialization.test.ts.)

import * as ledger from '@midnight-ntwrk/ledger-v9';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { createKeystore, type PublicKey, type UnshieldedKeystore } from '../src/KeyStore.js';
import { assertKeyAddressConsistency, assertSignatureMatchesKey } from '../src/SchemeConsistency.js';
import { SchemeMismatchError } from '../src/v1/WalletError.js';

const networkId = NetworkId.NetworkId.Undeployed;

// A single 32-byte scalar used under BOTH schemes. The ledger domain-separates
// derivation, so the same scalar yields disjoint keys/addresses per scheme —
// the cleanest source of genuinely mismatched, ledger-valid material (no fakes).
const secret = Buffer.alloc(32, 7);
const message = Buffer.from('attack at dawn', 'utf8');

const schnorr: UnshieldedKeystore = createKeystore({ kind: 'schnorr', secret }, networkId);
const ecdsa: UnshieldedKeystore = createKeystore({ kind: 'ecdsa', secret }, networkId);

const schnorrKey = schnorr.getPublicKey(); // { tag: 'schnorr', value: <64 hex> }
const ecdsaKey = ecdsa.getPublicKey(); //   { tag: 'ecdsa',   value: <66 hex> }
const schnorrSig = schnorr.signData(message); // { tag: 'schnorr', ... }
const ecdsaSig = ecdsa.signData(message); //     { tag: 'ecdsa',   ... }

const publicKeyOf = (keystore: UnshieldedKeystore): PublicKey => ({
  publicKey: keystore.getPublicKey(),
  addressHex: keystore.getAddress(),
  address: keystore.getBech32Address().asString(),
});

// A PublicKey that glues one scheme's key to the other scheme's address.
const splicedPublicKey = (keyFrom: UnshieldedKeystore, addressFrom: UnshieldedKeystore): PublicKey => ({
  publicKey: keyFrom.getPublicKey(),
  addressHex: addressFrom.getAddress(),
  address: addressFrom.getBech32Address().asString(),
});

const expectSchemeMismatch = (left: unknown, at: SchemeMismatchError['at']): void => {
  expect(left).toBeInstanceOf(SchemeMismatchError);
  if (!(left instanceof SchemeMismatchError)) {
    return;
  }
  expect(left._tag).toBe('Wallet.SchemeMismatch');
  expect(left.at).toBe(at);
  // expected/supplied are exactly the two schemes (order asserted per-case where known).
  expect([left.expected, left.supplied].sort((a, b) => a.localeCompare(b))).toEqual(['ecdsa', 'schnorr']);
};

describe('ECDSA-MM — scheme-mismatch rejection (#402 AC #4)', () => {
  describe('construction: address/key scheme must agree (MM-01, MM-02)', () => {
    it.each([
      { id: 'ECDSA-MM-01', title: 'Schnorr address + ECDSA key', keyFrom: ecdsa, addressFrom: schnorr },
      { id: 'ECDSA-MM-02', title: 'ECDSA address + Schnorr key', keyFrom: schnorr, addressFrom: ecdsa },
    ])('$id rejects "$title" at construction', ({ keyFrom, addressFrom }) => {
      const result = assertKeyAddressConsistency(splicedPublicKey(keyFrom, addressFrom));

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expectSchemeMismatch(result.left, 'construction');
      }
    });

    it.each([
      { id: 'schnorr', keystore: schnorr },
      { id: 'ecdsa', keystore: ecdsa },
    ])('accepts a self-consistent $id PublicKey (positive control)', ({ keystore }) => {
      const result = assertKeyAddressConsistency(publicKeyOf(keystore));

      expect(Either.isRight(result)).toBe(true);
    });
  });

  // An unshielded address is derived from its key, so its scheme is the key's
  // scheme; MM-03/MM-04 (address + signature) and MM-05 (key + signature, both
  // directions) reduce to the same key-vs-signature check — the two cases below
  // are those two directions and jointly satisfy all three IDs.
  describe('signature provision: signature must share the key scheme (MM-03, MM-04, MM-05)', () => {
    it.each([
      {
        id: 'ECDSA-MM-03 (= MM-05)',
        title: 'ECDSA key/address + Schnorr signature',
        key: ecdsaKey,
        sig: schnorrSig,
        expected: 'ecdsa',
        supplied: 'schnorr',
      },
      {
        id: 'ECDSA-MM-04 (= MM-05 inverse)',
        title: 'Schnorr key/address + ECDSA signature',
        key: schnorrKey,
        sig: ecdsaSig,
        expected: 'schnorr',
        supplied: 'ecdsa',
      },
    ])('$id rejects "$title" at signature provision', ({ key, sig, expected, supplied }) => {
      const result = assertSignatureMatchesKey(key, sig);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expectSchemeMismatch(result.left, 'signature-provision');
        expect(result.left.expected).toBe(expected); // exactly the key's scheme
        expect(result.left.supplied).toBe(supplied); // exactly the signature's scheme
      }
    });

    it.each([
      { id: 'schnorr', key: schnorrKey, sig: schnorrSig },
      { id: 'ecdsa', key: ecdsaKey, sig: ecdsaSig },
    ])('accepts a matching $id key+signature (positive control)', ({ key, sig }) => {
      const result = assertSignatureMatchesKey(key, sig);

      expect(Either.isRight(result)).toBe(true);
      // No coercion: the signature is returned unchanged.
      if (Either.isRight(result)) {
        expect(result.right).toEqual(sig);
      }
    });
  });

  describe('error quality (MM-06)', () => {
    it('ECDSA-MM-06 names both the expected and supplied scheme in the message', () => {
      const result = assertSignatureMatchesKey(ecdsaKey, schnorrSig);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left.message).toMatch(/ecdsa/i);
        expect(result.left.message).toMatch(/schnorr/i);
      }
    });
  });

  describe('no silent coercion / no fallback (MM-07, MM-08)', () => {
    it('ECDSA-MM-08 a mismatch is never silently coerced to a Right', () => {
      expect(Either.isLeft(assertSignatureMatchesKey(ecdsaKey, schnorrSig))).toBe(true);
      expect(Either.isLeft(assertSignatureMatchesKey(schnorrKey, ecdsaSig))).toBe(true);
    });

    it('ECDSA-MM-07 the guard is pure & synchronous — the mismatch is decidable before any submission', () => {
      // Returns an Either rather than throwing or performing I/O: a signing
      // pipeline threading through it short-circuits before building/submitting.
      const result = assertSignatureMatchesKey(ecdsaKey, schnorrSig);
      expect(Either.isEither(result)).toBe(true);
      expect(Either.isLeft(result)).toBe(true);
    });

    it('ECDSA-MM-08 (ledger floor) a cross-scheme signature does not verify — why coercion would be unsafe', () => {
      // Real-ledger anchor: runs today, no guard module required. Documents the
      // existing floor the wallet-level guards build on.
      expect(ledger.verifySignature(ecdsaKey, message, schnorrSig)).toBe(false);
      expect(ledger.verifySignature(schnorrKey, message, ecdsaSig)).toBe(false);
      expect(ledger.verifySignature(schnorrKey, message, schnorrSig)).toBe(true);
      expect(ledger.verifySignature(ecdsaKey, message, ecdsaSig)).toBe(true);
    });
  });

  describe('no key material in errors (S-04)', () => {
    it('ECDSA-S-04 mismatch errors name schemes but never leak key or secret bytes', () => {
      const forbidden = [
        Buffer.from(secret).toString('hex'),
        ecdsaKey.value,
        schnorrKey.value,
        schnorrSig.value,
        ecdsaSig.value,
      ];

      const sigResult = assertSignatureMatchesKey(ecdsaKey, schnorrSig);
      const addrResult = assertKeyAddressConsistency(splicedPublicKey(ecdsa, schnorr));
      expect(Either.isLeft(sigResult)).toBe(true);
      expect(Either.isLeft(addrResult)).toBe(true);

      const assertNamesNoSecrets = (message: string): void => {
        expect(message).not.toHaveLength(0);
        forbidden.forEach((fragment) => expect(message).not.toContain(fragment));
      };
      if (Either.isLeft(sigResult)) {
        assertNamesNoSecrets(sigResult.left.message);
      }
      if (Either.isLeft(addrResult) && addrResult.left instanceof SchemeMismatchError) {
        assertNamesNoSecrets(addrResult.left.message);
      }
    });
  });
});
