// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025-2026 Midnight Foundation
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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeSimulatorProvingServiceEffect } from '../provingService.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

const getNonDustImbalance = (imbalances: Map<ledger.TokenType, bigint>, rawTokenType: ledger.RawTokenType): bigint => {
  const [, value] = Array.from(imbalances.entries()).find(([t, value]) =>
    t.tag !== 'dust' && t.raw == rawTokenType ? value : undefined,
  ) ?? [undefined, BigInt(0)];

  return value;
};

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

  it('does transform unproven transaction into proof-erased transaction', async () => {
    const service = makeSimulatorProvingServiceEffect();
    const finalTx: ledger.ProofErasedTransaction = await service.prove(testUnprovenTx).pipe(Effect.runPromise);

    expect(finalTx).toBeInstanceOf(ledger.Transaction);
    expect(getNonDustImbalance(finalTx.imbalances(0), ledger.shieldedToken().raw)).toEqual(-42n);
  });
});
