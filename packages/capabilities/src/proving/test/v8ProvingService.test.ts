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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Proving from '../index.js';
import { type ProvingService } from '../provingService.js';
import { type V8UnboundTransaction, type V8UnprovenTransaction } from '../v8ProvingService.js';

const getNonDustImbalance = (imbalances: Map<ledger.TokenType, bigint>, rawTokenType: ledger.RawTokenType): bigint => {
  const [, value] = Array.from(imbalances.entries()).find(([t, value]) =>
    t.tag !== 'dust' && t.raw == rawTokenType ? value : undefined,
  ) ?? [undefined, BigInt(0)];

  return value;
};

/** A ledger-v8 transaction with one shielded output, so its proof-erased form still carries something to check. */
const makeTransaction = (): ledger.UnprovenTransaction => {
  const recipient = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
  const shieldedTokenType = ledger.shieldedToken();
  const coin = ledger.createShieldedCoinInfo(shieldedTokenType.raw, 42n);
  const output = ledger.ZswapOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
  const offer = ledger.ZswapOffer.fromOutput(output, shieldedTokenType.raw, 42n);
  return ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer);
};

describe('Ledger-v8 simulator proving service', () => {
  it('erases the proofs of a ledger-v8 transaction instead of proving it, for the in-memory simulator', async () => {
    expect(Proving).toHaveProperty('makeV8SimulatorProvingServiceEffect');

    const finalTx: ledger.ProofErasedTransaction = await Proving.makeV8SimulatorProvingServiceEffect()
      .prove(makeTransaction())
      .pipe(Effect.runPromise);

    expect(finalTx).toBeInstanceOf(ledger.Transaction);
    expect(() =>
      ledger.Transaction.deserialize('signature', 'no-proof', 'no-binding', finalTx.serialize()),
    ).not.toThrow();
    expect(getNonDustImbalance(finalTx.imbalances(0), ledger.shieldedToken().raw)).toEqual(-42n);
  });

  it('erases them behind a promise too, as the ledger-v9 simulator proving service does', async () => {
    expect(Proving).toHaveProperty('makeV8SimulatorProvingService');

    const finalTx: ledger.ProofErasedTransaction =
      await Proving.makeV8SimulatorProvingService().prove(makeTransaction());

    expect(finalTx).toBeInstanceOf(ledger.Transaction);
    expect(() =>
      ledger.Transaction.deserialize('signature', 'no-proof', 'no-binding', finalTx.serialize()),
    ).not.toThrow();
    expect(getNonDustImbalance(finalTx.imbalances(0), ledger.shieldedToken().raw)).toEqual(-42n);
  });
});

describe('Naming a ledger-v8 proving backend', () => {
  it('names the promise-facing ledger-v8 backend as it names the effect one', () => {
    type _1 = Expect<Equal<Proving.V8ProvingService, ProvingService<V8UnboundTransaction, V8UnprovenTransaction>>>;
  });
});
