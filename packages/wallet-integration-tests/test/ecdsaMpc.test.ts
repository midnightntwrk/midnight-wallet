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
// MPC signer integration (#402 §7 — ECDSA-MPC-01/02/03/04).
//
// A threshold-ECDSA backend is, to the wallet, a function that returns a valid
// ledger Signature for the wallet's verifying key. These tests use a fake
// coordinator (additive share fixtures, t-of-t) and verify the assembled
// signature with an independent @noble oracle, plus the orchestration semantics.
//
// NOTE (integration gap): the facade `signRecipe(recipe, signSegment)` callback
// is SYNCHRONOUS ((data) => Signature), but MPC is async. Wiring an async backend
// in requires either pre-signing each segment's data and returning the cached
// signature synchronously, or an async-capable signer pathway in the SDK. The
// signature produced here is exactly what such a pathway must feed in.
import * as ledger from '@midnight-ntwrk/ledger-v9';
import { describe, expect, it } from 'vitest';
import {
  FakeMpcCoordinator,
  MpcThresholdError,
  MpcTimeoutError,
  verifyEcdsaWithOracle,
} from './helpers/ecdsaSigners.js';

const secret = Buffer.alloc(32, 0x21);
const payload = new TextEncoder().encode('authorize unshielded spend');
const PARTIES = 3;

describe('ECDSA MPC signer integration (#402 §7)', () => {
  it('ECDSA-MPC-01: a signature assembled from the threshold shares verifies and authorizes', async () => {
    const coordinator = FakeMpcCoordinator.fromSecret(secret, PARTIES);

    // NOTE: this fake is t-of-t (all parties must participate); a true t-of-n
    // "enough-but-not-all" success path is not modelled here.
    const signature = await coordinator.requestSignature(payload, coordinator.allParticipants());

    expect(signature.tag).toBe('ecdsa');
    // Independent oracle AND the ledger accept it under the coordinator's public key —
    // i.e. it is a valid authorization for a spend owned by that key.
    expect(verifyEcdsaWithOracle(coordinator.publicKey, payload, signature)).toBe(true);
    expect(ledger.verifySignature(coordinator.publicKey, payload, signature)).toBe(true);
  });

  it('ECDSA-MPC-02: below-threshold participation yields a typed error and no signature', async () => {
    const coordinator = FakeMpcCoordinator.fromSecret(secret, PARTIES);
    const tooFew = coordinator.allParticipants().slice(0, PARTIES - 1);

    await expect(coordinator.requestSignature(payload, tooFew)).rejects.toBeInstanceOf(MpcThresholdError);
  });

  it('ECDSA-MPC-03: an unresponsive party times out cleanly without hanging', async () => {
    const coordinator = FakeMpcCoordinator.fromSecret(secret, PARTIES);
    // One party never responds within the timeout window.
    const participants = [{ index: 0 }, { index: 1 }, { index: 2, delayMs: 10_000 }];

    await expect(coordinator.requestSignature(payload, participants, 50)).rejects.toBeInstanceOf(MpcTimeoutError);
  });

  it('ECDSA-MPC-04: concurrent signing requests do not bleed into each other', async () => {
    const coordinator = FakeMpcCoordinator.fromSecret(secret, PARTIES);
    const payloadA = new TextEncoder().encode('spend A');
    const payloadB = new TextEncoder().encode('spend B');

    const [signatureA, signatureB] = await Promise.all([
      coordinator.requestSignature(payloadA, coordinator.allParticipants()),
      coordinator.requestSignature(payloadB, coordinator.allParticipants()),
    ]);

    // Each signature verifies against its own payload and not the other's.
    expect(verifyEcdsaWithOracle(coordinator.publicKey, payloadA, signatureA)).toBe(true);
    expect(verifyEcdsaWithOracle(coordinator.publicKey, payloadB, signatureB)).toBe(true);
    expect(verifyEcdsaWithOracle(coordinator.publicKey, payloadB, signatureA)).toBe(false);
    expect(verifyEcdsaWithOracle(coordinator.publicKey, payloadA, signatureB)).toBe(false);
  });
});
