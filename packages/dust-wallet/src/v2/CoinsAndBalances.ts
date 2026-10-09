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

export type CoinSelection = <TCoin extends CoinRecipe>(coins: readonly TCoin[]) => TCoin | undefined;

export const chooseCoin: CoinSelection = (coins) =>
  coins
    .filter((coin) => coin.value > 0n)
    .toSorted((a, b) => Number(a.value - b.value))
    .at(0);

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

  /**
   * Estimate when the dust a first-time registration may claim for its own fee will reach `fee`.
   *
   * @remarks
   *   Reads the same projection as {@link estimateDustGeneration}, over the UTxOs not yet registered for Dust generation:
   *   each grows at its `rate` up to its `maxCap`, and the estimate is the earliest whole second at which any one of
   *   them reaches the fee. Only one UTxO fills the registration's guaranteed slot, so amounts are never summed across
   *   UTxOs.
   * @example
   *   ```ts
   *   const estimate = coinsAndBalances.feeCoverageEstimate(state, nightUtxos, fee, new Date());
   *   if (estimate._tag === 'Reachable') console.log(`fee covered in ${estimate.seconds} s`);
   *   ```
   *
   * @param state Current state of the wallet
   * @param nightUtxos The Night UTxOs the registration would carry
   * @param fee The fee to cover, in Specks
   * @param currentTime The time to estimate from
   * @returns When the fee is covered, or why it never will be
   */
  feeCoverageEstimate(
    state: TState,
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    fee: bigint,
    currentTime: Date,
  ): FeeCoverageEstimate;
};

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
