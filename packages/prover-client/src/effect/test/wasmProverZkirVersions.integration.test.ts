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
 * Whether one in-process prover proves circuits of both ZKIR versions a ledger-v9 transaction can carry: the wallet's
 * own zswap and Dust circuits, which are ZKIR v2, and contract circuits compiled with compactc 0.36.0 or later, which
 * are ZKIR v3.
 *
 * @remarks
 *   The contract circuit is `add` from `resources/compactc-0.36.0/simple.compact`, with the IR and keys compactc 0.36.0
 *   generated for it. Its preimage is built straight from the public transcript `round.increment(1)` produces, so no
 *   contract is deployed and no transaction is built for it.
 *
 *   Network is needed (public parameters and the wallet's key material are fetched); Docker is not.
 */
import { readFileSync } from 'node:fs';
import * as ledger from '@midnightntwrk/ledger-v9';
import type { KeyMaterialProvider, ProvingKeyMaterial } from '@midnightntwrk/zkir-v2';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as WasmProver from '../WasmProver.js';

const timeoutMinutes = (mins: number) => 1_000 * 60 * mins;

const compiledAdd = (file: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./resources/compactc-0.36.0/${file}`, import.meta.url)));

/** Where the contract's `add` circuit is looked up; any location the wallet's own key material does not claim. */
const addKeyLocation = 'simple/add';

const addKeyMaterial: ProvingKeyMaterial = {
  ir: compiledAdd('add.bzkir'),
  proverKey: compiledAdd('add.prover'),
  verifierKey: compiledAdd('add.verifier'),
};

const walletKeyMaterial = WasmProver.makeV9KeyMaterialProvider();

/** Serves the contract's circuit the way a DApp's provider would, and the wallet's own circuits as the wallet does. */
const keyMaterialProvider: KeyMaterialProvider = {
  lookupKey: (keyLocation) =>
    keyLocation === addKeyLocation ? Promise.resolve(addKeyMaterial) : walletKeyMaterial.lookupKey(keyLocation),
  getParams: (k) => walletKeyMaterial.getParams(k),
};

const nothing: ledger.AlignedValue = { value: [], alignment: [] };

/**
 * The public transcript of `round.increment(1)`: index the contract's only ledger field, add one, write it back. Field
 * index 0 is written as no bytes, because field-aligned binary drops trailing zeros.
 */
const incrementRoundByOne: ledger.Op<ledger.AlignedValue>[] = [
  {
    idx: {
      cached: false,
      pushPath: true,
      path: [
        {
          tag: 'value',
          value: { value: [new Uint8Array()], alignment: [{ tag: 'atom', value: { tag: 'bytes', length: 1 } }] },
        },
      ],
    },
  },
  { addi: { immediate: 1 } },
  { ins: { cached: true, n: 1 } },
];

const addPreimage = (): Uint8Array =>
  ledger.proofDataIntoSerializedPreimage(nothing, nothing, incrementRoundByOne, [], addKeyLocation);

const aZswapOutputTransaction = (amount: bigint): ledger.UnprovenTransaction => {
  const shieldedTokenType = ledger.shieldedToken();
  const coin = ledger.createShieldedCoinInfo(shieldedTokenType.raw, amount);
  const output = ledger.ZswapOutput.new(coin, 0, ledger.sampleCoinPublicKey(), ledger.sampleEncryptionPublicKey());
  return ledger.Transaction.fromParts(
    'undeployed',
    ledger.ZswapOffer.fromOutput(output, shieldedTokenType.raw, amount),
  );
};

/** Checks the zswap proofs the way a node would: ledger-v9 itself, verifying native proofs. */
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

describe('the bundled in-process prover, on circuits of both ZKIR versions', () => {
  // One prover for every case: each proof has to reach the runtime its own circuit was compiled for.
  const prover = Effect.runSync(WasmProver.create({ keyMaterialProvider }));

  it(
    'should check a ZKIR v3 contract circuit, so a DApp circuit from compactc 0.36 can be proved in process',
    async () => {
      // One entry per public-input declaration in `add`, none of them skipped.
      await expect(prover.asProvingProvider().check(addPreimage(), addKeyLocation)).resolves.toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    },
    timeoutMinutes(5),
  );

  it(
    'should prove a ZKIR v3 contract circuit, so a DApp circuit from compactc 0.36 can be proved in process',
    async () => {
      const proof = await prover.asProvingProvider().prove(addPreimage(), addKeyLocation);

      expect(new TextDecoder().decode(proof.subarray(0, 'midnight:proof['.length))).toBe('midnight:proof[');
    },
    timeoutMinutes(5),
  );

  it(
    "should prove the wallet's own ZKIR v2 circuits on the same prover, so supporting v3 does not drop v2",
    async () => {
      const proven = await aZswapOutputTransaction(1_000n).prove(
        prover.asProvingProvider(),
        ledger.CostModel.initialCostModel(),
      );

      expect(() => verifyNatively(proven)).not.toThrow();
    },
    timeoutMinutes(10),
  );
});
