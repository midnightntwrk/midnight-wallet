// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeSimulatorProvingService } from '../Proving.js';
import { BALANCE_TRANSACTION_TO_PROVE, NOTHING_TO_PROVE, TRANSACTION_TO_PROVE } from '../ProvingRecipe.js';
import { getNonDustImbalance } from '../../test/testUtils.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

const makeTransaction = () => {
  const seed = Buffer.alloc(32, 0);
  const recipient = ledger.ZswapSecretKeys.fromSeed(seed);
  const amount = 42n;
  const shieldedTokenType = ledger.shieldedToken();
  const coin = ledger.createShieldedCoinInfo(shieldedTokenType.raw, amount);
  const output = ledger.ZswapOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
  const offer = ledger.ZswapOffer.fromOutput(output, shieldedTokenType.raw, amount);
  return ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer);
};

describe('Simulator proving service', () => {
  const testUnprovenTx = makeTransaction();
  const testErasedTx = makeTransaction().eraseProofs();

  const recipes = [
    { recipe: { type: NOTHING_TO_PROVE, transaction: testErasedTx }, expectedImbalance: -42n },
    {
      recipe: {
        type: BALANCE_TRANSACTION_TO_PROVE,
        transactionToBalance: testErasedTx,
        transactionToProve: testUnprovenTx,
      },
      expectedImbalance: -84n,
    },
    { recipe: { type: TRANSACTION_TO_PROVE, transaction: testUnprovenTx }, expectedImbalance: -42n },
  ] as const;

  it.each(recipes)(
    'does transform proving recipe into final, proof-erased transaction',
    async ({ recipe, expectedImbalance }) => {
      const service = makeSimulatorProvingService();
      const finalTx: ledger.ProofErasedTransaction = await service.prove(recipe).pipe(Effect.runPromise);

      expect(finalTx).toBeInstanceOf(ledger.Transaction);
      expect(getNonDustImbalance(finalTx.imbalances(0), ledger.shieldedToken().raw)).toEqual(expectedImbalance);
    },
  );
});
