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
import * as ledger from '@midnightntwrk/ledger-v9';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Proving from '../index.js';
import {
  makeV9SimulatorProvingServiceEffect,
  type ProvingService,
  type ProvingServiceEffect,
  type ProvingServices,
  type V9UnboundTransaction,
  type VersionedProvingService,
  type VersionedProvingServiceEffect,
} from '../provingService.js';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';

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
    const service = makeV9SimulatorProvingServiceEffect();
    const finalTx: ledger.ProofErasedTransaction = await service.prove(testUnprovenTx).pipe(Effect.runPromise);

    expect(finalTx).toBeInstanceOf(ledger.Transaction);
    expect(getNonDustImbalance(finalTx.imbalances(0), ledger.shieldedToken().raw)).toEqual(-42n);
  });
});

describe('Naming the ledger version a proving backend is written against', () => {
  it('requires every proving type to name the transaction it accepts, so none is ledger-v9 by omission', () => {
    // @ts-expect-error a backend names the unproven transaction it accepts
    type _1 = ProvingServiceEffect<V9UnboundTransaction>;
    // @ts-expect-error a backend names the unproven transaction it accepts
    type _2 = ProvingService<V9UnboundTransaction>;
    // @ts-expect-error a version-routed service names the unproven transactions it accepts
    type _3 = VersionedProvingServiceEffect<V9UnboundTransaction>;
    // @ts-expect-error a version-routed service names the unproven transactions it accepts
    type _4 = VersionedProvingService<V9UnboundTransaction>;
    // @ts-expect-error a registry names the unproven transactions its backends accept
    type _5 = ProvingServices<V9UnboundTransaction>;
  });

  it('names the ledger version of every backend that is built over one', () => {
    expect(Proving).toHaveProperty('makeV9SimulatorProvingServiceEffect');
    expect(Proving).toHaveProperty('makeV9SimulatorProvingService');
    expect(Proving).toHaveProperty('makeV9WasmProvingServices');
    expect(Proving).not.toHaveProperty('makeSimulatorProvingServiceEffect');
    expect(Proving).not.toHaveProperty('makeSimulatorProvingService');
    expect(Proving).not.toHaveProperty('makeWasmProvingServices');
  });

  it('offers no version-less name for the ledger-v9 proof server, which is makeV9ServerProvingService', () => {
    expect(Proving).not.toHaveProperty('makeDefaultProvingServiceEffect');
    expect(Proving).not.toHaveProperty('makeDefaultProvingService');
  });
});
