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
import { type CoinRecipe } from '@midnightntwrk/wallet-sdk-capabilities';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { pipe, Array as Arr, Order } from 'effect';
import { type CoreWallet } from './CoreWallet.js';
import { type KeysCapability } from './Keys.js';
import { type FeeCoverageEstimate } from './WalletError.js';
import {
  type DustGenerationDetails,
  type DustGenerationInfo,
  type Dust,
  type DustFullInfo,
  type UtxoWithMeta,
} from './types/Dust.js';
import { type CoinsAndBalancesCapability } from '../types/DustWalletCapabilities.js';
import { type Balance, type CoinWithValue, type UtxoWithFullDustDetails } from '../types/DustWalletTypes.js';

export type { CoinsAndBalancesCapability } from '../types/DustWalletCapabilities.js';
export type { Balance, CoinWithValue, UtxoWithFullDustDetails } from '../types/DustWalletTypes.js';

export type CoinSelection = <TCoin extends CoinRecipe>(coins: readonly TCoin[]) => TCoin | undefined;

export const chooseCoin: CoinSelection = (coins) =>
  coins
    .filter((coin) => coin.value > 0n)
    .toSorted((a, b) => Number(a.value - b.value))
    .at(0);

const FAKE_NONCE: ledger.DustInitialNonce = '0'.repeat(64);

/** `numerator / denominator` rounded up, for a positive `denominator`. */
const ceilDiv = (numerator: bigint, denominator: bigint): bigint => (numerator + denominator - 1n) / denominator;

/** Whole seconds, rounded up, from `from` until `time`; `0n` once `time` has passed. */
const secondsUntil = (time: Date, from: Date): bigint =>
  time > from ? ceilDiv(BigInt(time.getTime() - from.getTime()), 1000n) : 0n;

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

  const feeCoverageEstimate = (
    state: CoreWallet,
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    fee: bigint,
    currentTime: Date,
  ): FeeCoverageEstimate => {
    const claimable = pipe(
      estimateDustGeneration(state, nightUtxos, currentTime),
      Arr.filter((estimate) => !estimate.utxo.registeredForDustGeneration),
    );
    if (fee <= 0n || Arr.some(claimable, (estimate) => estimate.dust.generatedNow >= fee)) {
      return { _tag: 'Reachable', seconds: 0n, at: currentTime };
    }
    const generating = Arr.filter(claimable, (estimate) => estimate.dust.rate > 0n);
    return pipe(
      generating,
      Arr.filter((estimate) => estimate.dust.maxCap >= fee),
      // A UTxO whose creation time is still ahead of the clock generates nothing until then.
      Arr.map(
        (estimate) =>
          secondsUntil(estimate.utxo.ctime, currentTime) +
          ceilDiv(fee - estimate.dust.generatedNow, estimate.dust.rate),
      ),
      Arr.match({
        onEmpty: (): FeeCoverageEstimate => ({
          _tag: 'Unreachable',
          reason: Arr.isEmptyReadonlyArray(generating) ? 'NoGeneration' : 'ExceedsCap',
        }),
        onNonEmpty: (candidates): FeeCoverageEstimate => {
          const seconds = Arr.min(candidates, Order.bigint);
          return { _tag: 'Reachable', seconds, at: DateOps.addSeconds(currentTime, seconds) };
        },
      }),
    );
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
    feeCoverageEstimate,
  };
};
