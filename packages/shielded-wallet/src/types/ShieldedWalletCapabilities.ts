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
 * The capabilities both shielded variants offer over their own state, stated once.
 *
 * @remarks
 *   A variant's state is made of its ledger version's objects, but what these capabilities read out of it is the plain
 *   data `ShieldedWalletTypes.ts` declares, so the contract is the same for both variants and generic in the state
 *   alone. Capabilities whose signatures name a ledger version, or a variant's own errors, stay with the variant. Each
 *   variant's tree re-exports these under the names it always had, and the package exports them with its types, under
 *   the wallet's name, because the other wallets declare capabilities of the same names.
 */
import {
  type ShieldedAddress,
  type ShieldedCoinPublicKey,
  type ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk-address-format';
import { type AvailableCoin, type Balances, type PendingCoin, type ReservedCoin } from './ShieldedWalletTypes.js';

export type CoinsAndBalancesCapability<TState> = {
  getAvailableBalances(state: TState): Balances;
  getPendingBalances(state: TState): Balances;
  getTotalBalances(state: TState): Balances;
  getAvailableCoins(state: TState): readonly AvailableCoin[];
  getPendingCoins(state: TState): readonly PendingCoin[];
  getTotalCoins(state: TState): ReadonlyArray<AvailableCoin | PendingCoin>;
  /** Optional so that a capability implemented outside this package still satisfies the type; it then reports none. */
  getReservedCoins?(state: TState): readonly ReservedCoin[];
};

export type KeysCapability<TState> = {
  getCoinPublicKey(state: TState): ShieldedCoinPublicKey;
  getEncryptionPublicKey(state: TState): ShieldedEncryptionPublicKey;
  getAddress(state: TState): ShieldedAddress;
};
