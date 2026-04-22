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
import { type CoreWallet } from './CoreWallet.js';
import { type KeysCapability } from './Keys.js';
import {
  type DustGenerationDetails,
  type DustGenerationInfo,
  type Dust,
  type DustFullInfo,
  type UtxoWithMeta,
} from './types/Dust.js';

export type Balance = bigint;

export type CoinWithValue<TToken> = {
  token: TToken;
  value: Balance;
};

/**
 * Type describing a Night UTxO together with details of estimated Dust generation. It is meant to be primarily used for
 * fee estimation of Dust registration transaction
 */
export type UtxoWithFullDustDetails = Readonly<{
  utxo: UtxoWithMeta;
  dust: DustGenerationDetails;
}>;

export type CoinSelection<TInput> = (coins: readonly CoinWithValue<TInput>[]) => CoinWithValue<TInput> | undefined;

export const chooseCoin = <TInput>(coins: readonly CoinWithValue<TInput>[]): CoinWithValue<TInput> | undefined =>
  coins.toSorted((a, b) => Number(a.value - b.value)).at(0);

export type CoinsAndBalancesCapability<TState> = {
  getWalletBalance(state: TState, time: Date): Balance;
  getAvailableCoins(state: TState, time?: Date): readonly DustFullInfo[];
  getPendingCoins(state: TState, time?: Date): readonly DustFullInfo[];
  getTotalCoins(state: TState, time?: Date): ReadonlyArray<DustFullInfo>;
  getAvailableCoinsWithGeneratedDust(state: TState, currentTime: Date): ReadonlyArray<CoinWithValue<Dust>>;
  getGenerationInfo(state: TState, coin: Dust): DustGenerationInfo | undefined;

  /** Splits provided Night utxos into the ones that will be used as inputs in the guaranteed and fallible sections */
  splitNightUtxos(nightUtxos: ReadonlyArray<UtxoWithFullDustDetails>): {
    guaranteed: ReadonlyArray<UtxoWithFullDustDetails>;
    fallible: ReadonlyArray<UtxoWithFullDustDetails>;
  };

  /**
   * Estimate how much Dust would be available to use if the Utxos provided were used for Dust generation from their
   * beginning. This function is particularly useful for the purpose of registering for Dust generation and selecting
   * the Utxo to be used for paying fees and approving the registration itself.
   *
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

  const getGenerationInfo = (state: CoreWallet, coin: Dust): DustGenerationInfo | undefined => {
    const info = state.state.generationInfo(coin);
    return info && info.dtime
      ? {
          ...info,
          dtime: new Date(+info.dtime), // TODO: remove when the ledger start to return a date instead of the number
        }
      : info;
  };

  const resolveTime = (state: CoreWallet, time?: Date): Date => time ?? state.state.syncTime;

  const toFullInfo = (state: CoreWallet, coins: readonly Dust[], time: Date): readonly DustFullInfo[] =>
    coins.flatMap((coin) => {
      const genInfo = getGenerationInfo(state, coin);
      return genInfo ? [{ token: coin, ...getFullDustInfo(state.state.params, genInfo, coin, time) }] : [];
    });

  const availableDustTokens = (state: CoreWallet): Dust[] => {
    const pendingSpends = new Set([...state.pendingDust.values()].map((coin) => coin.nonce));
    return pipe(
      state.state.utxos,
      Arr.filter((coin) => !pendingSpends.has(coin.nonce)),
    );
  };

  const getAvailableCoins = (state: CoreWallet, time?: Date): readonly DustFullInfo[] =>
    toFullInfo(state, availableDustTokens(state), resolveTime(state, time));

  const getPendingCoins = (state: CoreWallet, time?: Date): readonly DustFullInfo[] =>
    toFullInfo(state, state.pendingDust, resolveTime(state, time));

  const getTotalCoins = (state: CoreWallet, time?: Date): ReadonlyArray<DustFullInfo> => {
    const effectiveTime = resolveTime(state, time);
    return [...getAvailableCoins(state, effectiveTime), ...getPendingCoins(state, effectiveTime)];
  };

  const getAvailableCoinsWithGeneratedDust = (state: CoreWallet, currentTime: Date): Array<CoinWithValue<Dust>> =>
    getAvailableCoins(state, currentTime).map((info) => ({ token: info.token, value: info.generatedNow }));

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

  /** Create a fake generation info for a given Utxo. It allows to estimate the Dust generation from it */
  const fakeGenerationInfo = (utxo: UtxoWithMeta, dustPublicKey: ledger.DustPublicKey): DustGenerationInfo => {
    return {
      value: utxo.value,
      owner: dustPublicKey,
      nonce: FAKE_NONCE,
      dtime: undefined,
    };
  };

  /** Create a fake dust coin for a given Utxo. It allows to estimate full details of the Dust generation from it */
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
    getGenerationInfo,
    estimateDustGeneration,
    splitNightUtxos,
  };
};
