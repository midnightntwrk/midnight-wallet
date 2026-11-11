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
import { tNightAmount } from './primitives.js';

// What the remote funding script sends to a test wallet and when it registers Night for Dust generation, as pure
// functions of the wallet's Night UTxOs, so every wallet shape can be checked without a live network.

/** The amount a test wallet normally receives in one UTxO. */
export const BASE_AMOUNT = tNightAmount(1000n);
/** One Night UTxO is this much larger and registered, so the wallet generates enough Dust to pay its own fees. */
export const DUST_GENERATOR_AMOUNT = BASE_AMOUNT * 10n;
/**
 * The dust healthchecks register two unregistered Night UTxOs and then deregister two registered ones, so the wallet
 * needs at least two of each: the registered generator and one more registered UTxO, and two unregistered others.
 */
export const MIN_NIGHT_UTXOS = 5;
export const MIN_UNREGISTERED_OTHERS = 2;
export const MIN_REGISTERED = 2;

/** The part of a wallet's Night UTxO the plan reads. */
export type NightCoin = {
  readonly utxo: { readonly value: bigint };
  readonly meta: { readonly registeredForDustGeneration: boolean };
};

export const isGenerator = (coin: NightCoin): boolean => coin.utxo.value >= DUST_GENERATOR_AMOUNT;
export const isRegistered = (coin: NightCoin): boolean => coin.meta.registeredForDustGeneration;

/** The Night UTxO amounts to send so the wallet reaches what the dust healthchecks need. */
export const planNightTopUp = (coins: readonly NightCoin[]): readonly bigint[] => {
  const hasGenerator = coins.some(isGenerator);
  const others = coins.filter((coin) => !isGenerator(coin));
  const unregisteredOthers = others.filter((coin) => !isRegistered(coin));
  const registeredBefore = coins.filter(isRegistered).length;
  // A registered wallet receives Night already registered, so sending more raises its registered count. A wallet
  // with none registers one of its others alongside the generator, so it needs one unregistered other to spare.
  const baseCount = Math.max(
    0,
    MIN_NIGHT_UTXOS - 1 - others.length,
    registeredBefore > 0 ? MIN_REGISTERED - registeredBefore : MIN_UNREGISTERED_OTHERS + 1 - unregisteredOthers.length,
  );
  return [...(hasGenerator ? [] : [DUST_GENERATOR_AMOUNT]), ...Array.from({ length: baseCount }, () => BASE_AMOUNT)];
};

/** What the funding script does about Dust once the funds have arrived. */
export type RegistrationStep<C extends NightCoin> =
  | { readonly _tag: 'Ready' }
  | { readonly _tag: 'WaitForDust' }
  | { readonly _tag: 'Register'; readonly utxos: readonly C[] };

/**
 * Decides, from the wallet's Night UTxOs and Dust once the funds have arrived, whether to register Night for Dust
 * generation, wait for registered Night to generate Dust, or do nothing.
 */
export const planRegistration = <C extends NightCoin>(coins: readonly C[], dust: bigint): RegistrationStep<C> => {
  const anyRegistered = coins.some(isRegistered);
  if (anyRegistered && dust > 0n) return { _tag: 'Ready' };
  const unregisteredGenerator = coins.find((coin) => isGenerator(coin) && !isRegistered(coin));
  if (anyRegistered || unregisteredGenerator === undefined) return { _tag: 'WaitForDust' };
  // One base-amount UTxO is registered with the generator, so the deregistration healthcheck finds two.
  const companion = coins.find((coin) => !isGenerator(coin) && !isRegistered(coin));
  return {
    _tag: 'Register',
    utxos: companion === undefined ? [unregisteredGenerator] : [unregisteredGenerator, companion],
  };
};

/** Why the funded wallet still cannot serve the dust healthchecks; empty when it can. */
export const readinessProblems = (coins: readonly NightCoin[], dust: bigint): readonly string[] => {
  const registered = coins.filter(isRegistered).length;
  return [
    ...(coins.length < MIN_NIGHT_UTXOS ? [`${coins.length} Night UTxOs, needs ${MIN_NIGHT_UTXOS}`] : []),
    ...(dust > 0n ? [] : ['no Dust to pay fees']),
    ...(registered < MIN_REGISTERED ? [`${registered} registered Night UTxOs, needs ${MIN_REGISTERED}`] : []),
  ];
};
