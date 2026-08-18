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
import { getBalanceRecipe, Imbalances } from '@midnightntwrk/wallet-sdk-capabilities';
import { describe, expect, test } from 'vitest';
import { chooseCoin } from '../CoinsAndBalances.js';
import { type Dust } from '../types/Dust.js';

const makeDustCoin = (nonce: bigint, value: bigint) => ({
  type: 'dust' as const,
  value,
  token: {
    initialValue: value,
    owner: 0n,
    nonce,
    seq: 0,
    ctime: new Date(0),
    backingNight: '0'.repeat(64),
    mtIndex: 0n,
  } satisfies Dust,
});

describe('chooseCoin filters zero-value coins', () => {
  test('returns undefined when every coin has value 0', () => {
    const coins = [makeDustCoin(1n, 0n), makeDustCoin(2n, 0n), makeDustCoin(3n, 0n)];
    expect(chooseCoin(coins)).toBeUndefined();
  });

  test('skips zero-value coins and picks the smallest positive coin', () => {
    const zero = makeDustCoin(1n, 0n);
    const small = makeDustCoin(2n, 5n);
    const big = makeDustCoin(3n, 100n);

    const picked = chooseCoin([zero, big, small]);

    expect(picked?.token.nonce).toBe(2n);
    expect(picked?.value).toBe(5n);
  });
});

describe('balancer integration with the dust call-site config', () => {
  test('balances a multi-coin deficit when a zero-value UTXO sits among a cohort of same-value coins', () => {
    const cohort = Array.from({ length: 13 }, (_, i) => makeDustCoin(BigInt(i + 1), 100n));
    const zeroValue = makeDustCoin(99n, 0n);

    const recipe = getBalanceRecipe({
      coins: [zeroValue, ...cohort],
      initialImbalances: Imbalances.fromEntry('dust', -350n),
      feeTokenType: 'dust',
      coinSelection: chooseCoin,
      transactionCostModel: { inputFeeOverhead: 0n, outputFeeOverhead: 0n },
      createOutput: (coin) => coin,
      isCoinEqual: (a, b) => a.token.nonce === b.token.nonce,
    });

    expect(recipe.inputs).toHaveLength(4);
    expect(recipe.inputs.some((i) => i.token.nonce === 99n)).toBe(false);
  });
});
