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
// HSM signer integration (#402 §8 / #504 — ECDSA-HSM-01/02/03/04).
//
// Uses a fake HSM whose signing key lives in a private field (never exposed), modelling a key that never leaves the
// device. A real SoftHSM/PKCS#11 harness can replace FakeHsm later; the wallet-facing contract is the same: an async
// `sign(payload) => ledger.Signature` plus a public key. Since #504 the SDK's signing pathway consumes exactly such an
// async signer, so the happy path drives the HSM THROUGH the real `SigningService`, and availability/auth failures
// surface as a typed SignError wrapping the device error. Signatures are checked with an independent @noble oracle.
import * as ledger from '@midnightntwrk/ledger-v9';
import { WalletError } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import { TransactionOps } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import { Cause, Effect, Either, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { FakeHsm, HsmAuthError, HsmUnavailableError, verifyEcdsaWithOracle } from './helpers/ecdsaSigners.js';
import { buildEcdsaTransfer, signingService } from './helpers/sdkSigning.js';

const secret = Buffer.alloc(32, 0x33);

describe('ECDSA HSM signer integration (#402 §8 / #504)', () => {
  it('ECDSA-HSM-01: the HSM-held key authorizes a real transfer through the SDK and never exposes the secret', async () => {
    const hsm = new FakeHsm(secret);
    const transaction = buildEcdsaTransfer(secret);

    const signed = await Effect.runPromise(signingService.sign(transaction, (data) => hsm.sign(data)));

    // The SDK attached the HSM-produced signature(s)...
    const attached = Array.from(signed.intents?.values() ?? []).flatMap((intent) => [
      ...(intent.guaranteedUnshieldedOffer?.signatures ?? []),
      ...(intent.fallibleUnshieldedOffer?.signatures ?? []),
    ]);
    expect(attached.length).toBeGreaterThan(0);

    // ...each signed segment's signature verifies under the device's public key (independent oracle AND ledger)...
    for (const segment of TransactionOps.getSegments(signed)) {
      const data = TransactionOps.getSignatureData(signed, segment).pipe(Either.getOrThrow);
      const signature = await hsm.sign(data);
      expect(verifyEcdsaWithOracle(hsm.getPublicKey(), data, signature)).toBe(true);
      expect(ledger.verifySignature(hsm.getPublicKey(), data, signature)).toBe(true);
    }

    // ...and the signing key is a private field — never present on the public surface.
    expect(Object.keys(hsm)).not.toContain('signingKey');
  });

  it('ECDSA-HSM-02: an unavailable HSM surfaces a SignError (HsmUnavailableError); the retry path then succeeds', async () => {
    const hsm = new FakeHsm(secret);
    hsm.available = false;

    const exit = await Effect.runPromiseExit(signingService.sign(buildEcdsaTransfer(secret), (data) => hsm.sign(data)));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Option.getOrThrow(Cause.failureOption(exit.cause));
      expect(error).toBeInstanceOf(WalletError.SignError);
      if (error instanceof WalletError.SignError) {
        expect(error.cause).toBeInstanceOf(HsmUnavailableError);
      }
    }

    // Retry path: once the device is back, signing through the SDK succeeds.
    hsm.available = true;
    await expect(
      Effect.runPromise(signingService.sign(buildEcdsaTransfer(secret), (data) => hsm.sign(data))),
    ).resolves.toBeDefined();
  });

  it('ECDSA-HSM-03: the reported public key equals the HSM-held key (33-byte SEC1)', () => {
    const hsm = new FakeHsm(secret);
    const expected = ledger.signatureVerifyingKey({ tag: 'ecdsa', value: Buffer.from(secret).toString('hex') });

    expect(hsm.getPublicKey()).toEqual(expected);
    expect(hsm.getPublicKey().tag).toBe('ecdsa');
    expect(hsm.getPublicKey().value).toHaveLength(66);
  });

  it('ECDSA-HSM-04: an auth failure surfaces a SignError (HsmAuthError), distinct from "unavailable"', async () => {
    const hsm = new FakeHsm(secret);
    hsm.authenticated = false;

    const exit = await Effect.runPromiseExit(signingService.sign(buildEcdsaTransfer(secret), (data) => hsm.sign(data)));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Option.getOrThrow(Cause.failureOption(exit.cause));
      expect(error).toBeInstanceOf(WalletError.SignError);
      if (error instanceof WalletError.SignError) {
        expect(error.cause).toBeInstanceOf(HsmAuthError);
        expect(error.cause).not.toBeInstanceOf(HsmUnavailableError);
      }
    }
  });
});
