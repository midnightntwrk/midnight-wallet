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
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { HashMap, Option, pipe } from 'effect';
import { RecordOps } from '@midnightntwrk/wallet-sdk-utilities';
import { UnshieldedState, type UtxoWithMeta } from './UnshieldedState.js';

export type Balances = Record<ledger.RawTokenType, bigint>;

/**
 * An outstanding reservation on a UTxO, as reported to consumers.
 *
 * Inputs are booked at balance time, so a caller that abandons a transaction before proving holds a booking nothing
 * will release on its behalf. `expiresAt` is the TTL of the transaction the booking was taken for: a booking past it is
 * stale and the wallet releases it on its next sync. A booking never survives a restart (ADR 0008).
 */
export type Booking = {
  readonly utxo: UtxoWithMeta;
  readonly expiresAt: Date;
};

export type CoinsAndBalancesCapability<TState> = {
  getAvailableBalances(state: TState): Balances;
  getPendingBalances(state: TState): Balances;
  getTotalBalances(state: TState): Balances;

  getAvailableCoins(state: TState): readonly UtxoWithMeta[];
  getPendingCoins(state: TState): readonly UtxoWithMeta[];
  getTotalCoins(state: TState): ReadonlyArray<UtxoWithMeta>;
  getBookings(state: TState): readonly Booking[];
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

  // Bookings never remove a coin from the owned set, so "every coin" is the owned map as it stands — no filtering.
  const getTotalCoins = (state: CoreWallet): readonly UtxoWithMeta[] => HashMap.toValues(state.state.utxos);

  // Iterates the bookings map itself — it is the smaller set, and each coin lookup is a direct O(1) probe.
  const getBookings = (state: CoreWallet): readonly Booking[] =>
    Array.from(HashMap.entries(state.state.bookings)).flatMap(([hash, booking]) =>
      pipe(
        HashMap.get(state.state.utxos, hash),
        Option.match({
          onNone: (): readonly Booking[] => [],
          onSome: (utxo) => [{ utxo, expiresAt: booking.expiresAt }],
        }),
      ),
    );

  return {
    getAvailableBalances,
    getPendingBalances,
    getTotalBalances,
    getAvailableCoins,
    getPendingCoins,
    getTotalCoins,
    getBookings,
  };
};
