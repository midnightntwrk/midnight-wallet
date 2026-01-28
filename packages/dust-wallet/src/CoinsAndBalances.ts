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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { DateOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { pipe, Array as Arr, Order } from 'effect';
import { DustCoreWallet } from './DustCoreWallet.js';
import { KeysCapability } from './Keys.js';
import { DustGenerationDetails, DustGenerationInfo, DustToken, DustTokenFullInfo, UtxoWithMeta } from './types/Dust.js';

export type Balance = bigint;

export type CoinWithValue<TToken> = {
  token: TToken;
  value: Balance;
};

/**
 * Type describing a Night UTxO together with details of estimated Dust generation.
 * It is meant to be primarily used for fee estimation of Dust registration transaction
 */
export type UtxoWithFullDustDetails = Readonly<{
  utxo: UtxoWithMeta;
  dust: DustGenerationDetails;
}>;

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

  /**
   * Splits provided Night utxos into the ones that will be used as inputs in the guaranteed and fallible sections
   */
  splitNightUtxos(nightUtxos: ReadonlyArray<UtxoWithFullDustDetails>): {
    guaranteed: ReadonlyArray<UtxoWithFullDustDetails>;
    fallible: ReadonlyArray<UtxoWithFullDustDetails>;
  };

  /**
   * Estimate how much Dust would be available to use if the Utxos provided were used for Dust generation from their beginning.
   * This function is particularly useful for the purpose of registering for Dust generation and selecting the Utxo to be used for paying fees and approving the registration itself.
   * @param state Current state of the wallet
   * @param nightUtxos Existing Night utxos
   * @param currentTime Current time
   * @returns Estimated Dust generation per Utxo
   */
  estimateDustGeneration(
    state: TState,
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    currentTime: Date,
  ): ReadonlyArray<UtxoWithFullDustDetails>;
};

const FAKE_NONCE: ledger.DustInitialNonce = '0'.repeat(64);

export type DefaultCoinsAndBalancesContext = {
  keysCapability: KeysCapability<DustCoreWallet>;
};
export const makeDefaultCoinsAndBalancesCapability = (
  config: object,
  getContext: () => DefaultCoinsAndBalancesContext,
): CoinsAndBalancesCapability<DustCoreWallet> => {
  const getWalletBalance = (state: DustCoreWallet, time: Date): Balance => {
    return state.state.walletBalance(time);
  };

  const getAvailableCoins = (state: DustCoreWallet): DustToken[] => {
    const pendingSpends = new Set([...state.pendingDustTokens.values()].map((coin) => coin.nonce));
    return pipe(
      state.state.utxos,
      Arr.filter((coin) => !pendingSpends.has(coin.nonce)),
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
        const generatedValue = ledger.updatedValue(
          coin.ctime,
          coin.initialValue,
          genInfo,
          currentTime,
          state.state.params,
        );
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
        result.push({
          token: coin,
          ...getFullDustInfo(state.state.params, genInfo, coin, blockTime),
        });
      }
    }

    return result;
  };

  const getFullDustInfo = (
    parameters: ledger.DustParameters,
    genInfo: DustGenerationInfo,
    coin: DustToken,
    currentTime: Date,
  ): DustGenerationDetails => {
    const generatedValue = ledger.updatedValue(coin.ctime, coin.initialValue, genInfo, currentTime, parameters);
    return {
      dtime: genInfo.dtime,
      maxCap: genInfo.value * parameters.nightDustRatio,
      maxCapReachedAt: DateOps.addSeconds(coin.ctime, parameters.timeToCapSeconds),
      generatedNow: generatedValue,
      rate: genInfo.value * parameters.generationDecayRate,
    };
  };

  const estimateDustGeneration = (
    state: DustCoreWallet,
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    currentTime: Date,
  ): ReadonlyArray<UtxoWithFullDustDetails> => {
    const dustPublicKey = getContext().keysCapability.getDustPublicKey(state);
    return pipe(
      nightUtxos,
      Arr.map((utxo) => {
        const genInfo = fakeGenerationInfo(utxo, dustPublicKey);
        const fakeDustCoin: DustToken = fakeDustToken(dustPublicKey, utxo);
        const details = getFullDustInfo(state.state.params, genInfo, fakeDustCoin, currentTime);
        return { utxo, dust: details };
      }),
    );
  };

  /**
   * Create a fake generation info for a given Utxo. It allows to estimate the Dust generation from it
   */
  const fakeGenerationInfo = (utxo: UtxoWithMeta, dustPublicKey: ledger.DustPublicKey): DustGenerationInfo => {
    return {
      value: utxo.value,
      owner: dustPublicKey,
      nonce: FAKE_NONCE,
      dtime: undefined,
    };
  };

  /**
   * Create a fake dust coin for a given Utxo. It allows to estimate full details of the Dust generation from it
   */
  const fakeDustToken = (dustPublicKey: ledger.DustPublicKey, utxo: UtxoWithMeta): DustToken => ({
    initialValue: 0n,
    owner: dustPublicKey,
    nonce: 0n,
    seq: 0,
    ctime: utxo.ctime,
    backingNight: '',
    mtIndex: 0n,
  });

  const splitNightUtxos = (utxos: ReadonlyArray<UtxoWithFullDustDetails>) => {
    const [guaranteed, fallible] = pipe(
      utxos,
      Arr.sort(
        pipe(
          Order.bigint,
          Order.reverse,
          Order.mapInput((coin: UtxoWithFullDustDetails) => coin.dust.generatedNow),
        ),
      ),
      Arr.splitAt(1),
    );

    return { guaranteed, fallible };
  };

  return {
    getWalletBalance,
    getAvailableCoins,
    getPendingCoins,
    getTotalCoins,
    getAvailableCoinsWithGeneratedDust,
    getAvailableCoinsWithFullInfo,
    getGenerationInfo,
    estimateDustGeneration,
    splitNightUtxos,
  };
};
