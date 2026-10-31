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
import { bookingDeadline, type CoreWallet } from './CoreWallet.js';
import { pipe, Array, Option } from 'effect';
import { RecordOps } from '@midnightntwrk/wallet-sdk-utilities';

import {
  type AvailableCoin,
  type Balances,
  type Coin,
  type PendingCoin,
  type ReservedCoin,
} from '../types/ShieldedWalletTypes.js';

import { type CoinsAndBalancesCapability } from '../types/ShieldedWalletCapabilities.js';

export type { AvailableCoin, Balances, Coin, PendingCoin, ReservedCoin } from '../types/ShieldedWalletTypes.js';
export type { CoinsAndBalancesCapability } from '../types/ShieldedWalletCapabilities.js';

const calculateBalances = <T extends AvailableCoin | PendingCoin>(coins: T[]): Balances =>
  coins.reduce(
    (acc: Balances, { coin }) => ({
      ...acc,
      [coin.type]: acc[coin.type] === undefined ? coin.value : acc[coin.type] + coin.value,
    }),
    {},
  );

export const makeDefaultCoinsAndBalancesCapability = (): Required<CoinsAndBalancesCapability<CoreWallet>> => {
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

  const getAvailableCoins = (state: CoreWallet): AvailableCoin[] => {
    const pendingSpends = new Set([...state.state.pendingSpends.values()].map(([coin]) => coin.nonce));
    return pipe(
      [...state.state.coins],
      Array.filter((coin) => !pendingSpends.has(coin.nonce)),
      Array.map((coin) => {
        return {
          coin,
          commitment: state.coinHashes[coin.nonce].commitment,
          nullifier: state.coinHashes[coin.nonce].nullifier,
        };
      }),
    );
  };

  const getPendingCoins = (state: CoreWallet): PendingCoin[] =>
    pipe(
      [...state.state.pendingOutputs.values()],
      Array.map(([coin, ttl]) => ({
        coin,
        ttl,
        commitment: state.coinHashes[coin.nonce].commitment,
        nullifier: state.coinHashes[coin.nonce].nullifier,
      })),
    );

  const getTotalCoins = (state: CoreWallet): Array<Coin> => [...getAvailableCoins(state), ...getPendingCoins(state)];

  // The deadline is derived by the same rule the sweep releases by (`bookingDeadline`), so what is reported is what
  // happens. Both times are unknown until sync has first seen the booking. A booked coin whose hash entry is missing
  // cannot be named by its nullifier yet, so it is left out of the view rather than assumed present and dereferenced.
  const getReservedCoins = (state: CoreWallet): ReservedCoin[] =>
    pipe(
      [...state.state.pendingSpends.values()],
      Array.filterMap(([coin]) =>
        pipe(
          Option.fromNullable(state.coinHashes[coin.nonce]),
          Option.map(({ nullifier }) => {
            const booking = state.bookings?.[coin.nonce];
            const reservedSince = booking?.seen;
            return {
              coin,
              nullifier,
              reservedSince,
              releasableAfter: reservedSince === undefined ? undefined : bookingDeadline(reservedSince, booking?.ttl),
            };
          }),
        ),
      ),
    );

  return {
    getAvailableBalances,
    getPendingBalances,
    getTotalBalances,
    getAvailableCoins,
    getPendingCoins,
    getTotalCoins,
    getReservedCoins,
  };
};
