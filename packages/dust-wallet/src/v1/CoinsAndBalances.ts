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
import { DateOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { pipe, Array as Arr, Order } from 'effect';
import { CoreWallet } from './CoreWallet.js';
import { KeysCapability } from './Keys.js';
import { DustGenerationDetails, DustGenerationInfo, Dust, DustFullInfo, UtxoWithMeta } from './types/Dust.js';

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
  getAvailableCoins(state: TState): readonly Dust[];
  getPendingCoins(state: TState): readonly Dust[];
  getTotalCoins(state: TState): ReadonlyArray<Dust>;
  getAvailableCoinsWithGeneratedDust(state: TState, currentTime: Date): ReadonlyArray<CoinWithValue<Dust>>;
  getAvailableCoinsWithFullInfo(state: TState, blockTime: Date): readonly DustFullInfo[];
  getGenerationInfo(state: TState, coin: Dust): DustGenerationInfo | undefined;

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
  keysCapability: KeysCapability<CoreWallet>;
};
export const makeDefaultCoinsAndBalancesCapability = (
  _config: unknown,
  getContext: () => DefaultCoinsAndBalancesContext,
): CoinsAndBalancesCapability<CoreWallet> => {
  const getWalletBalance = (state: CoreWallet, time: Date): Balance => {
    return state.state.walletBalance(time);
  };

  const getAvailableCoins = (state: CoreWallet): Dust[] => {
    const pendingSpends = new Set([...state.pendingDust.values()].map((coin) => coin.nonce));
    return pipe(
      state.state.utxos,
      Arr.filter((coin) => !pendingSpends.has(coin.nonce)),
    );
  };

  const getPendingCoins = (state: CoreWallet): Dust[] => state.pendingDust;

  const getTotalCoins = (state: CoreWallet): Array<Dust> => [...getAvailableCoins(state), ...getPendingCoins(state)];

  const getGenerationInfo = (state: CoreWallet, coin: Dust): DustGenerationInfo | undefined => {
    const info = state.state.generationInfo(coin);
    return info && info.dtime
      ? {
          ...info,
          dtime: new Date(+info.dtime), // TODO: remove when the ledger start to return a date instead of the number
        }
      : info;
  };

  const getAvailableCoinsWithGeneratedDust = (state: CoreWallet, currentTime: Date): Array<CoinWithValue<Dust>> => {
    const result: Array<CoinWithValue<Dust>> = [];
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

  const getAvailableCoinsWithFullInfo = (state: CoreWallet, blockTime: Date): Array<DustFullInfo> => {
    const result: Array<DustFullInfo> = [];
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
    coin: Dust,
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
    state: CoreWallet,
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    currentTime: Date,
  ): ReadonlyArray<UtxoWithFullDustDetails> => {
    const dustPublicKey = getContext().keysCapability.getPublicKey(state);
    return pipe(
      nightUtxos,
      Arr.map((utxo) => {
        const genInfo = fakeGenerationInfo(utxo, dustPublicKey);
        const fakeDustCoin: Dust = fakeDustToken(dustPublicKey, utxo);
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
  const fakeDustToken = (dustPublicKey: ledger.DustPublicKey, utxo: UtxoWithMeta): Dust => ({
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
