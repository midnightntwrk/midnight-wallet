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
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import {
  chooseCoin,
  makeDefaultCoinsAndBalancesCapability,
  type UtxoWithFullDustDetails,
} from '../CoinsAndBalances.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import {
  type DefaultTransactingConfiguration,
  type DefaultTransactingContext,
  makeDefaultTransactingCapability,
} from '../Transacting.js';

const NIGHT = ledger.nativeToken().raw;

const makeUtxoWithDust = (
  outputNo: number,
  value: bigint,
  generatedNow: bigint,
  registeredForDustGeneration: boolean,
): UtxoWithFullDustDetails => ({
  utxo: {
    value,
    owner: ledger.sampleUserAddress(),
    type: NIGHT,
    intentHash: ledger.sampleIntentHash(),
    outputNo,
    ctime: new Date(0),
    registeredForDustGeneration,
  },
  dust: {
    dtime: undefined,
    maxCap: 1_000_000n,
    maxCapReachedAt: new Date(2_000_000_000_000),
    generatedNow,
    rate: 1n,
  },
});

describe('splitNightUtxosForDustRegistration', () => {
  const config: DefaultTransactingConfiguration = {
    networkId: NetworkId.NetworkId.Undeployed,
    costParameters: { feeBlocksMargin: 5 },
  };
  const keysCapability = makeDefaultKeysCapability();
  const context: DefaultTransactingContext = {
    coinSelection: chooseCoin,
    coinsAndBalancesCapability: makeDefaultCoinsAndBalancesCapability(undefined, () => ({ keysCapability })),
    keysCapability,
  };
  const transacting = makeDefaultTransactingCapability(config, () => context);

  // The real splitNightUtxos sorts by `dust.generatedNow` descending and takes the first as
  // the guaranteed slot; the rest go to fallible. The tests below pick generatedNow values
  // explicitly so the guaranteed-vs-fallible split is predictable.

  it('registration: feePayment equals generatedNow of the guaranteed UTxO when it is unregistered', () => {
    const guaranteed = makeUtxoWithDust(0, 1_000n, 200n, false); // highest dust → guaranteed
    const fallible = makeUtxoWithDust(1, 1_000n, 100n, false);

    const result = transacting.splitNightUtxosForDustRegistration([guaranteed, fallible], true);

    expect(result.feePayment).toBe(200n);
    expect(result.guaranteedUtxos).toEqual([guaranteed]);
    expect(result.fallibleUtxos).toEqual([fallible]);
  });

  it('registration: feePayment is 0n when the guaranteed UTxO is already registered', () => {
    const guaranteed = makeUtxoWithDust(0, 1_000n, 200n, true); // already registered → excluded from fee
    const fallible = makeUtxoWithDust(1, 1_000n, 100n, false);

    const result = transacting.splitNightUtxosForDustRegistration([guaranteed, fallible], true);

    expect(result.feePayment).toBe(0n);
    expect(result.guaranteedUtxos).toEqual([guaranteed]);
  });

  it('deregistration: feePayment is 0n even when the guaranteed UTxO has generated dust', () => {
    const u1 = makeUtxoWithDust(0, 1_000n, 200n, false);
    const u2 = makeUtxoWithDust(1, 1_000n, 100n, false);

    const result = transacting.splitNightUtxosForDustRegistration([u1, u2], false);

    expect(result.feePayment).toBe(0n);
  });
});
