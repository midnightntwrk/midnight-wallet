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
 * Whether the bundled in-process prover can prove a _ledger-v8_ transaction with ledger-v8's key material.
 *
 * @remarks
 *   The zkir runtime the worker drives is shared by both ledger versions, so nothing about the proving loop itself is
 *   version-specific — but the circuits the keys were generated for are: ledger-v8 was built with circuit generation 9,
 *   ledger-v9 with generation 10. `makeV8KeyMaterialProvider` reads generation 9, and this proves a ledger-v8
 *   transaction with it and asks ledger-v8, under a strictness that verifies native proofs, whether it accepts the
 *   proof.
 *
 *   Only the zswap proofs are verified this way: the published ledger WASM builds do not verify Dust spend proofs, so a
 *   Dust spend proved with the wrong generation passes here and fails only at a node.
 *
 *   Network is needed (the key material is fetched); Docker is not.
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as WasmProver from '../WasmProver.js';

const timeoutMinutes = (mins: number) => 1_000 * 60 * mins;

const aV8Transaction = (spendCoinAmount: bigint): ledger.UnprovenTransaction => {
  const shieldedTokenType = ledger.shieldedToken();
  const spendCoin = ledger.createShieldedCoinInfo(shieldedTokenType.raw, spendCoinAmount);
  const output = ledger.ZswapOutput.new(spendCoin, 0, ledger.sampleCoinPublicKey(), ledger.sampleEncryptionPublicKey());
  const offer = ledger.ZswapOffer.fromOutput(output, shieldedTokenType.raw, spendCoinAmount);
  return ledger.Transaction.fromParts('undeployed', offer);
};

const proveWithV8KeyMaterial = (): Promise<
  ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>
> =>
  Effect.runPromise(WasmProver.create({ keyMaterialProvider: WasmProver.makeV8KeyMaterialProvider() })).then((prover) =>
    aV8Transaction(1_000n).prove(prover.asV8ProvingProvider(), ledger.CostModel.initialCostModel()),
  );

/** Checks the proof the way a node would: ledger-v8 itself, verifying native proofs. */
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

describe('the bundled in-process prover, on ledger-v8', () => {
  it(
    "proves a ledger-v8 transaction with ledger-v8's key material, and ledger-v8 verifies the proof",
    async () => {
      const proven = await proveWithV8KeyMaterial();

      expect(() => verifyNatively(proven)).not.toThrow();
    },
    timeoutMinutes(10),
  );
});
