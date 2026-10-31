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

/**
 * The capabilities both dust variants offer over their own state, stated once.
 *
 * @remarks
 *   A variant's state is made of its ledger version's objects, but what these capabilities read out of it is the plain
 *   data `DustWalletTypes.ts` declares, so the contract is the same for both variants and generic in the state alone.
 *   Capabilities whose signatures name a ledger version, or a variant's own errors, stay with the variant. Each
 *   variant's tree re-exports these under the names it always had, and the package exports them with its types, under
 *   the wallet's name, because the other wallets declare capabilities of the same names.
 */
import { type DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import {
  type Balance,
  type CoinWithValue,
  type Dust,
  type DustFullInfo,
  type DustGenerationInfo,
  type DustPublicKey,
  type FeeCoverageEstimate,
  type UtxoWithFullDustDetails,
  type UtxoWithMeta,
} from './DustWalletTypes.js';

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

export type KeysCapability<TState> = {
  getPublicKey(state: TState): DustPublicKey;
  getAddress(state: TState): DustAddress;
};
