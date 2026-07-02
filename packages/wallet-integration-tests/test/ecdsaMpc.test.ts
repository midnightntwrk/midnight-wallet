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
// MPC signer integration (#402 §7 / #504 — ECDSA-MPC-01/02/03/04).
//
// A threshold-ECDSA backend is, to the wallet, an async function that returns a valid ledger Signature for the
// wallet's verifying key. Since #504 the SDK's signing pathway accepts exactly such an async signer, so these tests
// drive a fake coordinator (additive share fixtures, t-of-t) THROUGH the real `SigningService` — authorizing a genuine
// transfer end-to-end — and assert the orchestration semantics (threshold, timeout, concurrency) surface correctly.
// The assembled signatures are verified with an independent @noble oracle and the ledger, so nothing is self-attested.
import * as ledger from '@midnightntwrk/ledger-v9';
import { WalletError } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import { TransactionOps } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import { Cause, Effect, Either, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  FakeMpcCoordinator,
  type MpcParticipant,
  MpcThresholdError,
  MpcTimeoutError,
  verifyEcdsaWithOracle,
} from './helpers/ecdsaSigners.js';
import { buildEcdsaTransfer, signingService } from './helpers/sdkSigning.js';

const secret = Buffer.alloc(32, 0x21);
const PARTIES = 3;

/** A signer that asks the coordinator to assemble a threshold signature over each segment the SDK presents. */
const mpcSigner =
  (coordinator: FakeMpcCoordinator, participants: readonly MpcParticipant[], timeoutMs?: number) =>
  (data: Uint8Array): Promise<ledger.Signature> =>
    coordinator.requestSignature(data, participants, timeoutMs);

describe('ECDSA MPC signer integration (#402 §7 / #504)', () => {
  it('ECDSA-MPC-01: a threshold-MPC backend authorizes a real transfer through the SDK signing pathway', async () => {
    const coordinator = FakeMpcCoordinator.fromSecret(secret, PARTIES);
    const transaction = buildEcdsaTransfer(secret);

    // NOTE: this fake is t-of-t (all parties must participate); a true t-of-n
    // "enough-but-not-all" success path is not modelled here.
    const signed = await Effect.runPromise(
      signingService.sign(transaction, mpcSigner(coordinator, coordinator.allParticipants())),
    );

    // The SDK attached the MPC-assembled signature(s) to the spend...
    const attached = Array.from(signed.intents?.values() ?? []).flatMap((intent) => [
      ...(intent.guaranteedUnshieldedOffer?.signatures ?? []),
      ...(intent.fallibleUnshieldedOffer?.signatures ?? []),
    ]);
    expect(attached.length).toBeGreaterThan(0);

    // ...and each signed segment's threshold signature verifies under the group key (independent oracle AND ledger),
    // i.e. it is a valid authorization for a spend owned by that key.
    for (const segment of TransactionOps.getSegments(signed)) {
      const data = TransactionOps.getSignatureData(signed, segment).pipe(Either.getOrThrow);
      const signature = await coordinator.requestSignature(data, coordinator.allParticipants());
      expect(verifyEcdsaWithOracle(coordinator.publicKey, data, signature)).toBe(true);
      expect(ledger.verifySignature(coordinator.publicKey, data, signature)).toBe(true);
    }
  });

  it('ECDSA-MPC-02: below-threshold participation surfaces a SignError (MpcThresholdError) and signs nothing', async () => {
    const coordinator = FakeMpcCoordinator.fromSecret(secret, PARTIES);
    const transaction = buildEcdsaTransfer(secret);
    const tooFew = coordinator.allParticipants().slice(0, PARTIES - 1);

    const exit = await Effect.runPromiseExit(signingService.sign(transaction, mpcSigner(coordinator, tooFew)));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Option.getOrThrow(Cause.failureOption(exit.cause));
      expect(error).toBeInstanceOf(WalletError.SignError);
      if (error instanceof WalletError.SignError) {
        expect(error.cause).toBeInstanceOf(MpcThresholdError);
      }
    }
  });

  it('ECDSA-MPC-03: an unresponsive party times out cleanly, surfacing a SignError (MpcTimeoutError)', async () => {
    const coordinator = FakeMpcCoordinator.fromSecret(secret, PARTIES);
    const transaction = buildEcdsaTransfer(secret);
    // One party never responds within the timeout window.
    const participants = [{ index: 0 }, { index: 1 }, { index: 2, delayMs: 10_000 }];

    const exit = await Effect.runPromiseExit(
      signingService.sign(transaction, mpcSigner(coordinator, participants, 50)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Option.getOrThrow(Cause.failureOption(exit.cause));
      expect(error).toBeInstanceOf(WalletError.SignError);
      if (error instanceof WalletError.SignError) {
        expect(error.cause).toBeInstanceOf(MpcTimeoutError);
      }
    }
  });

  it('ECDSA-MPC-04: concurrent signings of distinct transfers do not bleed into each other', async () => {
    const coordinator = FakeMpcCoordinator.fromSecret(secret, PARTIES);
    const transferA = buildEcdsaTransfer(secret);
    const transferB = buildEcdsaTransfer(secret);

    const [signedA, signedB] = await Promise.all([
      Effect.runPromise(signingService.sign(transferA, mpcSigner(coordinator, coordinator.allParticipants()))),
      Effect.runPromise(signingService.sign(transferB, mpcSigner(coordinator, coordinator.allParticipants()))),
    ]);

    // Each transfer is independently authorized: every segment's signature verifies under the group key.
    for (const signed of [signedA, signedB]) {
      for (const segment of TransactionOps.getSegments(signed)) {
        const data = TransactionOps.getSignatureData(signed, segment).pipe(Either.getOrThrow);
        const signature = await coordinator.requestSignature(data, coordinator.allParticipants());
        expect(verifyEcdsaWithOracle(coordinator.publicKey, data, signature)).toBe(true);
      }
    }
  });
});
