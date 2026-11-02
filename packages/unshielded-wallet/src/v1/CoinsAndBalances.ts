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
import { type CoreWallet } from './CoreWallet.js';
import { pipe } from 'effect';
import { RecordOps } from '@midnightntwrk/wallet-sdk-utilities';
import { UnshieldedState, type UtxoWithMeta } from './UnshieldedState.js';
import { type CoinsAndBalancesCapability } from '../types/UnshieldedWalletCapabilities.js';
import { type Balances } from '../types/UnshieldedWalletTypes.js';

export type { CoinsAndBalancesCapability } from '../types/UnshieldedWalletCapabilities.js';
export type { Balances } from '../types/UnshieldedWalletTypes.js';

const calculateBalances = (utxos: readonly UtxoWithMeta[]): Balances =>
  utxos.reduce(
    (acc: Balances, { utxo }) => ({
      ...acc,
      [utxo.type]: acc[utxo.type] === undefined ? utxo.value : acc[utxo.type] + utxo.value,
    }),
    {},
  );

export const makeDefaultCoinsAndBalancesCapability = (): CoinsAndBalancesCapability<CoreWallet> => {
  const getAvailableBalances = (state: CoreWallet): Balances => {
    const availableCoins = getAvailableCoins(state);

    return calculateBalances(availableCoins);
  };

  const getPendingBalances = (state: CoreWallet): Balances => {
    const pendingCoins = getPendingCoins(state);

    return calculateBalances(pendingCoins);
  };

  const getTotalBalances = (state: CoreWallet): Balances => {
    const availableBalances = getAvailableBalances(state);
    const pendingBalances = getPendingBalances(state);

    return pipe(
      [availableBalances, pendingBalances],
      RecordOps.mergeWithAccumulator(0n, (a, b) => a + b),
    );
  };

  const getAvailableCoins = (state: CoreWallet): readonly UtxoWithMeta[] =>
    UnshieldedState.toArrays(state.state).availableUtxos;

  const getPendingCoins = (state: CoreWallet): readonly UtxoWithMeta[] =>
    UnshieldedState.toArrays(state.state).pendingUtxos.map(({ utxo }) => utxo);

  const getTotalCoins = (state: CoreWallet): readonly UtxoWithMeta[] => [
    ...getAvailableCoins(state),
    ...getPendingCoins(state),
  ];

  return {
    getAvailableBalances,
    getPendingBalances,
    getTotalBalances,
    getAvailableCoins,
    getPendingCoins,
    getTotalCoins,
  };
};
