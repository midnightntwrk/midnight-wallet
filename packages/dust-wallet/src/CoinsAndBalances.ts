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
import { Array, pipe } from 'effect';
import { updatedValue } from '@midnight-ntwrk/ledger-v6';
import { DateOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { DustCoreWallet } from './DustCoreWallet.js';
import { DustGenerationInfo, DustToken, DustTokenFullInfo } from './types/Dust.js';

export type Balance = bigint;

export type CoinWithValue<TToken> = {
  token: TToken;
  value: Balance;
};

export type CoinSelection<TInput> = (
  coins: readonly CoinWithValue<TInput>[],
  amountNeeded: Balance,
) => CoinWithValue<TInput>[];

export const chooseCoin = <TInput>(
  coins: readonly CoinWithValue<TInput>[],
  amountNeeded: Balance,
): CoinWithValue<TInput>[] => {
  let sum = 0n;
  const sorted = coins.toSorted((a, b) => Number(a.value - b.value));
  const result = [];
  for (const coin of sorted) {
    sum += coin.value;
    result.push(coin);
    if (sum >= amountNeeded) break;
  }
  return result;
};

export type CoinsAndBalancesCapability<TState> = {
  getWalletBalance(state: TState, time: Date): Balance;
  getAvailableCoins(state: TState): readonly DustToken[];
  getPendingCoins(state: TState): readonly DustToken[];
  getTotalCoins(state: TState): ReadonlyArray<DustToken>;
  getAvailableCoinsWithGeneratedDust(state: TState, currentTime: Date): ReadonlyArray<CoinWithValue<DustToken>>;
  getAvailableCoinsWithFullInfo(state: TState, blockTime: Date): readonly DustTokenFullInfo[];
  getGenerationInfo(state: TState, token: DustToken): DustGenerationInfo | undefined;
};

export const makeDefaultCoinsAndBalancesCapability = (): CoinsAndBalancesCapability<DustCoreWallet> => {
  const getWalletBalance = (state: DustCoreWallet, time: Date): Balance => {
    return state.state.walletBalance(time);
  };

  const getAvailableCoins = (state: DustCoreWallet): DustToken[] => {
    const pendingSpends = new Set([...state.pendingDustTokens.values()].map((coin) => coin.nonce));
    return pipe(
      state.state.utxos,
      Array.filter((coin) => !pendingSpends.has(coin.nonce)),
    );
  };

  const getPendingCoins = (state: DustCoreWallet): DustToken[] => state.pendingDustTokens;

  const getTotalCoins = (state: DustCoreWallet): Array<DustToken> => [
    ...getAvailableCoins(state),
    ...getPendingCoins(state),
  ];

  const getGenerationInfo = (state: DustCoreWallet, token: DustToken): DustGenerationInfo | undefined => {
    const info = state.state.generationInfo(token);
    return info && info.dtime
      ? {
          ...info,
          dtime: new Date(+info.dtime), // TODO: remove when the ledger start to return a date instead of the number
        }
      : info;
  };

  const getAvailableCoinsWithGeneratedDust = (
    state: DustCoreWallet,
    currentTime: Date,
  ): Array<CoinWithValue<DustToken>> => {
    const result: Array<CoinWithValue<DustToken>> = [];
    const available = getAvailableCoins(state);

    for (const coin of available) {
      const genInfo = getGenerationInfo(state, coin);
      if (genInfo) {
        const generatedValue = updatedValue(coin.ctime, coin.initialValue, genInfo, currentTime, state.state.params);
        result.push({ token: coin, value: generatedValue });
      }
    }

    return result;
  };

  const getAvailableCoinsWithFullInfo = (state: DustCoreWallet, blockTime: Date): Array<DustTokenFullInfo> => {
    const result: Array<DustTokenFullInfo> = [];
    const available = getAvailableCoins(state);
    for (const coin of available) {
      const genInfo = getGenerationInfo(state, coin);
      if (genInfo) {
        const generatedValue = updatedValue(coin.ctime, coin.initialValue, genInfo, blockTime, state.state.params);
        result.push({
          token: coin,
          dtime: genInfo.dtime,
          maxCap: genInfo.value * state.state.params.nightDustRatio,
          maxCapReachedAt: DateOps.addSeconds(coin.ctime, state.state.params.timeToCapSeconds),
          generatedNow: generatedValue,
          rate: genInfo.value * state.state.params.generationDecayRate,
        });
      }
    }

    return result;
  };

  return {
    getWalletBalance,
    getAvailableCoins,
    getPendingCoins,
    getTotalCoins,
    getAvailableCoinsWithGeneratedDust,
    getAvailableCoinsWithFullInfo,
    getGenerationInfo,
  };
};
