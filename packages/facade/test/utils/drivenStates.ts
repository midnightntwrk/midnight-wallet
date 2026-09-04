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
 * Moving three wallets across a protocol boundary without a chain.
 *
 * @remarks
 *   The facade learns which side of the boundary it is on from the three wallets' own state streams, and nothing else.
 *   Driving them across a real fork means three simulated chains, a replay and a cross-ledger migration inside one
 *   facade suite, which proves the wallets rather than the facade. So these suites take a real, shipped, unstarted
 *   wallet's own published state and restate it at the version a crossing would put it at: everything but the version
 *   is the wallet's, delegated through, so what reaches the facade has exactly the shape the wallet publishes.
 */

import { type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustWalletState } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWalletState } from '@midnightntwrk/wallet-sdk-shielded';
import { UnshieldedWalletState } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import type * as rx from 'rxjs';

/** A shielded wallet's own state, restated at another protocol version. */
export const shieldedAt = (state: ShieldedWalletState, version: ProtocolVersion.ProtocolVersion): ShieldedWalletState =>
  new ShieldedWalletState(version, state.state, {
    balances: () => state.balances,
    totalCoins: () => state.totalCoins,
    availableCoins: () => state.availableCoins,
    pendingCoins: () => state.pendingCoins,
    coinPublicKey: () => state.coinPublicKey,
    encryptionPublicKey: () => state.encryptionPublicKey,
    address: () => state.address,
    serialize: () => state.serialize(),
  });

/** An unshielded wallet's own state, restated at another protocol version. */
export const unshieldedAt = (
  state: UnshieldedWalletState,
  version: ProtocolVersion.ProtocolVersion,
): UnshieldedWalletState =>
  new UnshieldedWalletState(version, state.state, {
    balances: () => state.balances,
    totalCoins: () => state.totalCoins,
    availableCoins: () => state.availableCoins,
    pendingCoins: () => state.pendingCoins,
    address: () => state.address,
    serialize: () => state.serialize(),
  });

/** A dust wallet's own state, restated at another protocol version. */
export const dustAt = (state: DustWalletState, version: ProtocolVersion.ProtocolVersion): DustWalletState =>
  new DustWalletState(version, state.state, {
    totalCoins: () => state.totalCoins,
    availableCoins: () => state.availableCoins,
    pendingCoins: () => state.pendingCoins,
    publicKey: () => state.publicKey,
    address: () => state.address,
    balance: (time) => state.balance(time),
    estimateDustGeneration: (utxos, time) => state.estimateDustGeneration(utxos, time),
    splitNightUtxos: (utxos) => state.splitNightUtxos(utxos),
    serialize: () => state.serialize(),
  });

/** Replaces a wallet's state stream with one the suite drives, leaving everything else about the wallet real. */
export const drivenBy = <TWallet extends object, TState>(
  wallet: TWallet,
  states: rx.Observable<TState>,
): rx.Observable<TState> => {
  Object.defineProperty(wallet, 'state', { value: states, configurable: true });
  return states;
};
