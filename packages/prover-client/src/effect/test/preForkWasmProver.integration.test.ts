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
/**
 * Whether the bundled in-process prover can prove a _pre-fork_ transaction, and with which key material.
 *
 * @remarks
 *   The zkir runtime the worker drives is shared by both ledger lines, so nothing about the proving loop itself is
 *   version-specific — but the circuits the keys were generated for are, and the bucket has a line per circuit
 *   generation rather than per ledger. Which line pairs with `@midnight-ntwrk/ledger-v8` is therefore an empirical
 *   question, and this is where it is answered: by proving a pre-fork transaction with each line and asking the
 *   pre-fork ledger, under a strictness that verifies native proofs, which one it accepts.
 *
 *   The answer today is line 9 — the same line the current ledger uses — which is why
 *   `makePreForkWasmProvingServiceEffect` applies no override. Line 8 predates the shared runtime: its verifier keys
 *   carry a header one generation old and are rejected before any proof is attempted. Should the bucket be refreshed,
 *   the second test here is what says so.
 *
 *   Network is needed (the key material comes from S3); Docker is not.
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as WasmProver from '../WasmProver.js';

const timeoutMinutes = (mins: number) => 1_000 * 60 * mins;

const aPreForkTransaction = (spendCoinAmount: bigint): ledger.UnprovenTransaction => {
  const shieldedTokenType = ledger.shieldedToken();
  const spendCoin = ledger.createShieldedCoinInfo(shieldedTokenType.raw, spendCoinAmount);
  const output = ledger.ZswapOutput.new(spendCoin, 0, ledger.sampleCoinPublicKey(), ledger.sampleEncryptionPublicKey());
  const offer = ledger.ZswapOffer.fromOutput(output, shieldedTokenType.raw, spendCoinAmount);
  return ledger.Transaction.fromParts('undeployed', offer);
};

const proveWith = (
  circuits: 8 | 9,
): Promise<ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>> =>
  Effect.runPromise(
    WasmProver.create({ keyMaterialProvider: WasmProver.makeDefaultKeyMaterialProvider({ circuits }) }),
  ).then((prover) =>
    aPreForkTransaction(1_000n).prove(prover.asPreForkProvingProvider(), ledger.CostModel.initialCostModel()),
  );

/** Checks the proof the way a node would: the pre-fork ledger itself, verifying native proofs. */
const verifyNatively = (
  transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>,
): void => {
  const strictness = new ledger.WellFormedStrictness();
  strictness.enforceBalancing = false;
  strictness.verifyNativeProofs = true;
  strictness.verifyContractProofs = false;
  strictness.enforceLimits = false;
  strictness.verifySignatures = false;
  transaction.wellFormed(ledger.LedgerState.blank('undeployed'), strictness, new Date(0));
};

describe('the bundled in-process prover, on the pre-fork ledger', () => {
  it(
    'proves a pre-fork transaction with the key material it defaults to, and the pre-fork ledger verifies the proof',
    async () => {
      const proven = await proveWith(9);

      expect(() => verifyNatively(proven)).not.toThrow();
    },
    timeoutMinutes(10),
  );

  it(
    'cannot use the line named after the pre-fork ledger, whose verifier keys predate the shared zkir runtime',
    async () => {
      await expect(proveWith(8)).rejects.toThrow(/verifier-key\[v5\]/);
    },
    timeoutMinutes(10),
  );
});
