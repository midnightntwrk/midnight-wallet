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
// ─────────────────────────────────────────────────────────────────────────────
// STATUS: RED scaffold (TDD). The scheme DISCRIMINATOR already exists on v2 —
// ledger-v9 keys/signatures are tagged `{ tag: SignatureKind, value }`, and
// `createKeystore({ kind, secret })` produces real scheme-tagged material. What
// does NOT yet exist is the wallet-side REJECTION of mismatched combinations.
// This file imports a PROPOSED guard module that an implementer must create to
// turn the matrix green. Per CLAUDE.md TDD: the test is the specification —
// review/ratify the contract below before implementing, and do not weaken these
// assertions to fit the implementation.
//
// ── Proposed contract: `packages/unshielded-wallet/src/SchemeConsistency.ts` ──
//
//   import { Data, Either } from 'effect';
//   import { addressFromKey, type Signature, type SignatureVerifyingKey,
//            type SignatureKind } from '@midnight-ntwrk/ledger-v9';
//   import type { PublicKey } from './KeyStore.js';
//
//   // Add to the WalletError union in src/v1/WalletError.ts.
//   export class SchemeMismatchError extends Data.TaggedError('Wallet.SchemeMismatch')<{
//     message: string;                       // names BOTH the expected and supplied scheme
//     expected: SignatureKind;
//     supplied: SignatureKind;
//     at: 'construction' | 'signature-provision' | 'deserialization';
//   }> {}
//
//   // MM-01/02 — the stored address must be derivable from the stored key.
//   // Left when addressFromKey(publicKey.publicKey) !== publicKey.addressHex.
//   export const assertKeyAddressConsistency:
//     (publicKey: PublicKey) => Either.Either<PublicKey, SchemeMismatchError>;
//
//   // MM-03/04/05 — a supplied signature must share the key's scheme tag.
//   // Left when key.tag !== signature.tag.
//   export const assertSignatureMatchesKey:
//     (key: SignatureVerifyingKey, signature: Signature) => Either.Either<Signature, SchemeMismatchError>;
//
//   // MM-09 — a tagged key's encoding length must match its tag
//   // (schnorr = 32-byte x-only / 64 hex; ecdsa = 33-byte SEC1 / 66 hex).
//   export const assertKeyTagConsistency:
//     (key: SignatureVerifyingKey) => Either.Either<SignatureVerifyingKey, SchemeMismatchError>;
//
// Wire these in: `assertKeyAddressConsistency` from CoreWallet.init/restore;
// `assertSignatureMatchesKey` inside signUnprovenTransaction/signUnboundTransaction
// (before the signature is attached); `assertKeyTagConsistency` on the deserialize
// path. Until the module exists, every guard-backed case below fails on a dynamic
// import — which IS the expected red reason.
// ─────────────────────────────────────────────────────────────────────────────

import * as ledger from '@midnight-ntwrk/ledger-v9';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { createKeystore, type PublicKey, type UnshieldedKeystore } from '../src/KeyStore.js';

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

// The proposed guard module does not exist yet. It is loaded through a
// dynamically-built specifier so the suite TYPE-CHECKS and RUNS today: the
// real-ledger anchor cases pass, while every guard-backed case fails at runtime
// with a clear "Cannot find module ../src/SchemeConsistency.js" — the TDD red
// that names exactly what to implement. (A static
// `import('../src/SchemeConsistency.js')` would instead abort the whole package
// typecheck with TS2307 before any assertion runs.)
type SchemeGuards = {
  assertKeyAddressConsistency: (publicKey: PublicKey) => Either.Either<PublicKey, unknown>;
  assertSignatureMatchesKey: (
    key: ledger.SignatureVerifyingKey,
    signature: ledger.Signature,
  ) => Either.Either<ledger.Signature, unknown>;
  assertKeyTagConsistency: (key: ledger.SignatureVerifyingKey) => Either.Either<ledger.SignatureVerifyingKey, unknown>;
};
// Typed as `string` (not a literal) so TypeScript does not attempt to resolve it.
const GUARDS_MODULE: string = '../src/SchemeConsistency.js';
const loadGuards = (): Promise<SchemeGuards> => import(/* @vite-ignore */ GUARDS_MODULE) as Promise<SchemeGuards>;

const expectSchemeMismatch = (left: unknown, at: 'construction' | 'signature-provision' | 'deserialization'): void => {
  // Structural assertion against the Data.TaggedError contract (avoids a static
  // import of a not-yet-existing type while still pinning the exact shape).
  const err = left as { _tag?: string; at?: string; expected?: string; supplied?: string; message?: string };
  expect(err._tag).toBe('Wallet.SchemeMismatch');
  expect(err.at).toBe(at);
  // expected/supplied are exactly the two schemes (order asserted per-case where known).
  expect([err.expected, err.supplied].sort()).toEqual(['ecdsa', 'schnorr']);
};

describe('ECDSA-MM — scheme-mismatch rejection (#402 AC #4)', () => {
  describe('construction: address/key scheme must agree (MM-01, MM-02)', () => {
    it.each([
      { id: 'ECDSA-MM-01', title: 'Schnorr address + ECDSA key', keyFrom: ecdsa, addressFrom: schnorr },
      { id: 'ECDSA-MM-02', title: 'ECDSA address + Schnorr key', keyFrom: schnorr, addressFrom: ecdsa },
    ])('$id rejects "$title" at construction', async ({ keyFrom, addressFrom }) => {
      const { assertKeyAddressConsistency } = await loadGuards();
      const result = assertKeyAddressConsistency(splicedPublicKey(keyFrom, addressFrom));

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expectSchemeMismatch(result.left, 'construction');
      }
    });

    it.each([
      { id: 'schnorr', keystore: schnorr },
      { id: 'ecdsa', keystore: ecdsa },
    ])('accepts a self-consistent $id PublicKey (positive control)', async ({ keystore }) => {
      const { assertKeyAddressConsistency } = await loadGuards();
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
    ])('$id rejects "$title" at signature provision', async ({ key, sig, expected, supplied }) => {
      const { assertSignatureMatchesKey } = await loadGuards();
      const result = assertSignatureMatchesKey(key, sig);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expectSchemeMismatch(result.left, 'signature-provision');
        const err = result.left as { expected: string; supplied: string };
        expect(err.expected).toBe(expected); // exactly the key's scheme
        expect(err.supplied).toBe(supplied); // exactly the signature's scheme
      }
    });

    it.each([
      { id: 'schnorr', key: schnorrKey, sig: schnorrSig },
      { id: 'ecdsa', key: ecdsaKey, sig: ecdsaSig },
    ])('accepts a matching $id key+signature (positive control)', async ({ key, sig }) => {
      const { assertSignatureMatchesKey } = await loadGuards();
      const result = assertSignatureMatchesKey(key, sig);

      expect(Either.isRight(result)).toBe(true);
      // No coercion: the signature is returned unchanged.
      if (Either.isRight(result)) {
        expect(result.right).toEqual(sig);
      }
    });
  });

  describe('error quality (MM-06)', () => {
    it('ECDSA-MM-06 names both the expected and supplied scheme in the message', async () => {
      const { assertSignatureMatchesKey } = await loadGuards();
      const result = assertSignatureMatchesKey(ecdsaKey, schnorrSig);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const { message } = result.left as { message: string };
        expect(message).toMatch(/ecdsa/i);
        expect(message).toMatch(/schnorr/i);
      }
    });
  });

  describe('no silent coercion / no fallback (MM-07, MM-08)', () => {
    it('ECDSA-MM-08 a mismatch is never silently coerced to a Right', async () => {
      const { assertSignatureMatchesKey } = await loadGuards();

      expect(Either.isLeft(assertSignatureMatchesKey(ecdsaKey, schnorrSig))).toBe(true);
      expect(Either.isLeft(assertSignatureMatchesKey(schnorrKey, ecdsaSig))).toBe(true);
    });

    it('ECDSA-MM-07 the guard is pure & synchronous — the mismatch is decidable before any submission', async () => {
      const { assertSignatureMatchesKey } = await loadGuards();
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

  describe('tag-enforced encoding (MM-09)', () => {
    it.each([
      {
        id: 'ECDSA-MM-09a',
        title: 'ecdsa tag with schnorr-length value',
        key: { tag: 'ecdsa' as const, value: schnorrKey.value },
      },
      {
        id: 'ECDSA-MM-09b',
        title: 'schnorr tag with ecdsa-length value',
        key: { tag: 'schnorr' as const, value: ecdsaKey.value },
      },
    ])('$id rejects "$title" (tag↔encoding length must agree)', async ({ key }) => {
      const { assertKeyTagConsistency } = await loadGuards();
      const result = assertKeyTagConsistency(key);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expectSchemeMismatch(result.left, 'deserialization');
      }
    });

    it.each([
      { id: 'schnorr', key: schnorrKey },
      { id: 'ecdsa', key: ecdsaKey },
    ])('accepts a well-formed $id key (positive control)', async ({ key }) => {
      const { assertKeyTagConsistency } = await loadGuards();
      expect(Either.isRight(assertKeyTagConsistency(key))).toBe(true);
    });
  });

  describe('no key material in errors (S-04)', () => {
    it('ECDSA-S-04 mismatch errors name schemes but never leak key or secret bytes', async () => {
      const { assertSignatureMatchesKey, assertKeyAddressConsistency } = await loadGuards();
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

      const messages = [
        Either.isLeft(sigResult) ? (sigResult.left as { message: string }).message : '',
        Either.isLeft(addrResult) ? (addrResult.left as { message: string }).message : '',
      ];
      messages.forEach((message) => {
        expect(message.length).toBeGreaterThan(0);
        forbidden.forEach((fragment) => expect(message).not.toContain(fragment));
      });
    });
  });
});
