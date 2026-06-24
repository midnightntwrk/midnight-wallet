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
// HSM signer integration (#402 §8 — ECDSA-HSM-01/02/03/04).
//
// Uses a fake HSM whose signing key lives in a private field (never exposed),
// modelling a key that never leaves the device. A real SoftHSM/PKCS#11 harness
// can replace FakeHsm in CI later; the wallet-facing contract is the same:
// `sign(payload) => ledger.Signature` plus a public key, with availability and
// auth failures surfaced as distinct typed errors. Signatures are checked with
// an independent @noble oracle.
import * as ledger from '@midnightntwrk/ledger-v9';
import { describe, expect, it } from 'vitest';
import { FakeHsm, HsmAuthError, HsmUnavailableError, verifyEcdsaWithOracle } from './helpers/ecdsaSigners.js';

const secret = Buffer.alloc(32, 0x33);
const payload = new TextEncoder().encode('authorize unshielded spend');

describe('ECDSA HSM signer integration (#402 §8)', () => {
  it('ECDSA-HSM-01: signs with the HSM-held key, verifies, and never exposes the secret', async () => {
    const hsm = new FakeHsm(secret);

    const signature = await hsm.sign(payload);

    expect(signature.tag).toBe('ecdsa');
    expect(verifyEcdsaWithOracle(hsm.getPublicKey(), payload, signature)).toBe(true);
    expect(ledger.verifySignature(hsm.getPublicKey(), payload, signature)).toBe(true);
    // The signing key is a private field — not present on the public surface.
    expect(Object.keys(hsm)).not.toContain('signingKey');
  });

  it('ECDSA-HSM-02: an unavailable HSM surfaces a typed error and does not crash', async () => {
    const hsm = new FakeHsm(secret);
    hsm.available = false;

    await expect(hsm.sign(payload)).rejects.toBeInstanceOf(HsmUnavailableError);
    // Retry path: once the device is back, signing succeeds.
    hsm.available = true;
    await expect(hsm.sign(payload)).resolves.toMatchObject({ tag: 'ecdsa' });
  });

  it('ECDSA-HSM-03: the reported public key equals the HSM-held key (33-byte SEC1)', () => {
    const hsm = new FakeHsm(secret);
    const expected = ledger.signatureVerifyingKey({ tag: 'ecdsa', value: Buffer.from(secret).toString('hex') });

    expect(hsm.getPublicKey()).toEqual(expected);
    expect(hsm.getPublicKey().tag).toBe('ecdsa');
    expect(hsm.getPublicKey().value).toHaveLength(66);
  });

  it('ECDSA-HSM-04: an auth failure is distinct from "unavailable"', async () => {
    const hsm = new FakeHsm(secret);
    hsm.authenticated = false;

    await expect(hsm.sign(payload)).rejects.toBeInstanceOf(HsmAuthError);
    await expect(hsm.sign(payload)).rejects.not.toBeInstanceOf(HsmUnavailableError);
  });
});
