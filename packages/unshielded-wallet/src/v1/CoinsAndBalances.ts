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
import { CoreWallet } from './CoreWallet.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { pipe } from 'effect';
import { RecordOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { UnshieldedState, UtxoWithMeta } from './UnshieldedState.js';

export type Balances = Record<ledger.RawTokenType, bigint>;

export type CoinsAndBalancesCapability<TState> = {
  getAvailableBalances(state: TState): Balances;
  getPendingBalances(state: TState): Balances;
  getTotalBalances(state: TState): Balances;

  getAvailableCoins(state: TState): readonly UtxoWithMeta[];
  getPendingCoins(state: TState): readonly UtxoWithMeta[];
  getTotalCoins(state: TState): ReadonlyArray<UtxoWithMeta>;
};

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
    UnshieldedState.toArrays(state.state).pendingUtxos;

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
