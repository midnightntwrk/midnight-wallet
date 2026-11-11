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
import { Either } from 'effect';
import { tNightAmount } from './primitives.js';
import { type StableBalance } from './stableWallet.js';

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
/**
 * Dust a funded wallet holds before the suites run: enough for a transaction fee with room to spare, the same amount
 * the suites' own `waitForDustBalance` waits for.
 */
export const MIN_DUST_FOR_FEES = 7n * 10n ** 14n;

/** The part of a wallet's Night UTxO the plan reads. */
export type NightCoin = {
  readonly utxo: { readonly value: bigint };
  readonly meta: { readonly registeredForDustGeneration: boolean };
};

export const isGenerator = (coin: NightCoin): boolean => coin.utxo.value >= DUST_GENERATOR_AMOUNT;
export const isRegistered = (coin: NightCoin): boolean => coin.meta.registeredForDustGeneration;

/**
 * Dust generation is keyed on a Night address, while each UTxO carries its own flag. A deregistration removes the
 * address's registration but leaves the flag on the UTxOs it did not spend, so a wallet can hold flagged UTxOs on an
 * address that is no longer registered; Night sent to it then arrives unregistered, while Night sent to a registered
 * address arrives registered. Nothing here relies on how sent Night will arrive: the top-up plans as if it arrives
 * unregistered, and registration is decided from the flags read once the funds are there.
 */
const registeredCount = (coins: readonly NightCoin[]): number => coins.filter(isRegistered).length;
const isUnregisteredOther = (coin: NightCoin): boolean => !isGenerator(coin) && !isRegistered(coin);
const hasRegisteredGenerator = (coins: readonly NightCoin[]): boolean =>
  coins.some((coin) => isGenerator(coin) && isRegistered(coin));

/**
 * How many base UTxOs a registration must take besides the generator to bring the registered count to
 * {@link MIN_REGISTERED}. The generator is always registered first, whether it is already held or about to be sent.
 */
const othersToRegister = (coins: readonly NightCoin[]): number =>
  Math.max(0, MIN_REGISTERED - registeredCount(coins) - (hasRegisteredGenerator(coins) ? 0 : 1));

/** The Night UTxO amounts to send so the wallet reaches what the dust healthchecks need. */
export const planNightTopUp = (coins: readonly NightCoin[]): readonly bigint[] => {
  const others = coins.filter((coin) => !isGenerator(coin));
  // Registration takes unregistered others, and the registration healthcheck needs MIN_UNREGISTERED_OTHERS left after.
  const baseCount = Math.max(
    0,
    MIN_NIGHT_UTXOS - 1 - others.length,
    MIN_UNREGISTERED_OTHERS + othersToRegister(coins) - coins.filter(isUnregisteredOther).length,
  );
  return [
    ...(coins.some(isGenerator) ? [] : [DUST_GENERATOR_AMOUNT]),
    ...Array.from({ length: baseCount }, () => BASE_AMOUNT),
  ];
};

/** What the funding script does about Dust once the funds have arrived. */
export type RegistrationStep<C extends NightCoin> =
  | { readonly _tag: 'Ready' }
  | { readonly _tag: 'WaitForDust' }
  | { readonly _tag: 'Register'; readonly utxos: readonly C[] };

/**
 * Decides, from the wallet's Night UTxOs and Dust once the funds have arrived, whether to register Night for Dust
 * generation, wait for registered Night to generate Dust, or do nothing. The generator is registered whenever it is
 * not, and unregistered base UTxOs join it until {@link MIN_REGISTERED} are registered. A Dust balance does not stand in
 * for a registration: a deregistered wallet keeps decaying Dust for a while.
 */
export const planRegistration = <C extends NightCoin>(coins: readonly C[], dust: bigint): RegistrationStep<C> => {
  const generator = hasRegisteredGenerator(coins)
    ? []
    : coins.filter((coin) => isGenerator(coin) && !isRegistered(coin)).slice(0, 1);
  const others = coins
    .filter(isUnregisteredOther)
    .slice(0, Math.max(0, MIN_REGISTERED - registeredCount(coins) - generator.length));
  const utxos = [...generator, ...others];
  if (utxos.length > 0) return { _tag: 'Register', utxos };
  return dust > 0n ? { _tag: 'Ready' } : { _tag: 'WaitForDust' };
};

/** Why the funded wallet still cannot serve the dust healthchecks; empty when it can. */
export const readinessProblems = (coins: readonly NightCoin[], dust: bigint): readonly string[] => {
  const registered = registeredCount(coins);
  const unregisteredOthers = coins.filter(isUnregisteredOther).length;
  return [
    ...(coins.length < MIN_NIGHT_UTXOS ? [`${coins.length} Night UTxOs, needs ${MIN_NIGHT_UTXOS}`] : []),
    ...(dust > 0n ? [] : ['no Dust to pay fees']),
    ...(registered < MIN_REGISTERED ? [`${registered} registered Night UTxOs, needs ${MIN_REGISTERED}`] : []),
    ...(hasRegisteredGenerator(coins) ? [] : ['the generator is not registered for Dust generation']),
    ...(unregisteredOthers < MIN_UNREGISTERED_OTHERS
      ? [
          `${unregisteredOthers} unregistered Night UTxOs besides the generator, the dust registration healthcheck needs ` +
            `${MIN_UNREGISTERED_OTHERS}. Night sent to this wallet arrives registered while its address is registered; ` +
            'after a deregistration (as the dust deregistration healthcheck makes) a funding run can add unregistered ones',
        ]
      : []),
  ];
};

/** The wallet the funding script funds: one generated for this run, or the one `SEED2` names. */
export type FundingTarget = { readonly _tag: 'Random' } | { readonly _tag: 'Given'; readonly seed: string };

/** What the funding script reads from its environment. */
export type FundingEnvironment = {
  readonly funder: string;
  readonly target: FundingTarget;
  readonly stable: string | undefined;
};

/**
 * Reads the funding script's environment: `SEED` (the funding wallet), `SEED2` or `FUND_RANDOM_TARGET` (the wallet to
 * fund) and `SEED_STABLE` (the balance-constant wallet). An empty value, as `NAME=` in `.env` leaves, counts as unset.
 */
export const parseFundingEnvironment = (
  env: Readonly<Record<string, string | undefined>>,
): Either.Either<FundingEnvironment, string> => {
  const valueOf = (name: string): string | undefined => {
    const value = env[name];
    return value === undefined || value === '' ? undefined : value;
  };
  const funder = valueOf('SEED');
  if (funder === undefined) return Either.left('SEED must be set to a wallet that holds funds');
  const random = valueOf('FUND_RANDOM_TARGET') === 'true';
  const given = valueOf('SEED2');
  if (!random && given === undefined) {
    return Either.left('SEED2 must be set to the wallet to fund, or set FUND_RANDOM_TARGET=true to fund a new one');
  }
  return Either.right({
    funder,
    target: random || given === undefined ? { _tag: 'Random' } : { _tag: 'Given', seed: given },
    stable: valueOf('SEED_STABLE'),
  });
};

/** One of the stable wallet's balances, with what it holds now. */
export type HeldStableBalance = StableBalance & { readonly held: bigint };

/** What to send the stable wallet, and which balances are already above their target. */
export type StableTopUp = {
  readonly short: readonly (StableBalance & { readonly short: bigint })[];
  readonly over: readonly HeldStableBalance[];
};

export const planStableTopUp = (current: readonly HeldStableBalance[]): StableTopUp => {
  const over = current.filter(({ held, amount }) => held > amount);
  const short =
    over.length > 0
      ? []
      : current
          .filter(({ held, amount }) => held < amount)
          .map(({ label, kind, tokenType, amount, held }) => ({
            label,
            kind,
            tokenType,
            amount,
            short: amount - held,
          }));
  return { short, over };
};

/**
 * Builds a Dust registration, and when it falls short of its fee, waits that shortfall out and builds it again, up to
 * `maxAttempts` builds in all. `waitOutShortfall` rethrows any error that is not a fee shortfall it can wait out.
 */
export const registerWithRetries = async <R>(
  register: () => Promise<R>,
  waitOutShortfall: (error: unknown, attempt: number) => Promise<void>,
  maxAttempts: number,
): Promise<R> => {
  const attempt = (n: number): Promise<R> =>
    register().catch(async (error: unknown) => {
      if (n >= maxAttempts) throw error;
      await waitOutShortfall(error, n);
      return attempt(n + 1);
    });
  return attempt(1);
};
