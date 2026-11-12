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
import { describe, expect, test } from 'vitest';
import {
  BASE_AMOUNT,
  DUST_GENERATOR_AMOUNT,
  MIN_DUST_FOR_FEES,
  type NightCoin,
  parseFundingEnvironment,
  planNightTopUp,
  planRegistration,
  planStableTopUp,
  readinessProblems,
  registerWithRetries,
} from './fundingPlan.js';
import { tNightAmount } from './primitives.js';
import { STABLE_WALLET } from './stableWallet.js';

// Dust generation is keyed on a Night address, while each UTxO carries its own flag. A deregistration removes the
// address's registration but leaves the flag on the UTxOs it did not spend, which keep generating Dust until they are
// spent. The dust healthchecks register and then deregister on every run, so the wallet the funding script meets
// usually has flagged UTxOs on an unregistered address. Night sent to it then arrives unregistered; Night sent to an
// address that is still registered arrives registered. The plan therefore never relies on how sent Night will arrive,
// and decides about registration from the flags it reads once the funds are there.

const coin = (value: bigint, registered: boolean): NightCoin => ({
  utxo: { value },
  meta: { registeredForDustGeneration: registered },
});
const generator = (registered: boolean) => coin(DUST_GENERATOR_AMOUNT, registered);
const base = (registered: boolean) => coin(BASE_AMOUNT, registered);
/** A UTxO left from the old, smaller funding amounts, or small change. */
const small = (registered: boolean) => coin(tNightAmount(10n), registered);
const enoughDust = MIN_DUST_FOR_FEES;

describe('planNightTopUp', () => {
  test('should send a generator and four base UTxOs to an empty wallet', () => {
    expect(planNightTopUp([])).toEqual([DUST_GENERATOR_AMOUNT, BASE_AMOUNT, BASE_AMOUNT, BASE_AMOUNT, BASE_AMOUNT]);
  });

  test('should send nothing to the wallet the dust healthchecks leave behind, which already holds two of each', () => {
    const wallet = [base(true), base(true), generator(false), base(false), base(false)];

    expect(planNightTopUp(wallet)).toEqual([]);
  });

  test('should send nothing when registering the unregistered generator alone brings the registered count to two', () => {
    const wallet = [generator(false), base(true), base(false), base(false), base(false)];

    expect(planNightTopUp(wallet)).toEqual([]);
  });

  test('should send a base UTxO to a registered wallet short of unregistered UTxOs, because it arrives unregistered once the address has been deregistered', () => {
    const wallet = [generator(true), base(true), base(true), base(true), base(false)];

    expect(planNightTopUp(wallet)).toEqual([BASE_AMOUNT]);
  });
});

describe('planNightTopUp, with UTxOs below the base amount', () => {
  test('should not count UTxOs below the base amount, so legacy 10 tNight UTxOs do not stand in for the ones the healthchecks spend', () => {
    const wallet = [generator(true), base(true), small(false), small(false), small(false), small(false)];

    expect(planNightTopUp(wallet)).toEqual([BASE_AMOUNT, BASE_AMOUNT, BASE_AMOUNT]);
  });
});

describe('planRegistration', () => {
  test('should register the generator and one base UTxO of a wallet with nothing registered', () => {
    const wallet = [generator(false), base(false), base(false), base(false), base(false)];

    expect(planRegistration(wallet, 0n)).toEqual({ _tag: 'Register', utxos: [wallet[0], wallet[1]] });
  });

  test('should register the unregistered generator when only one UTxO is registered, even though the wallet holds Dust, because that Dust may be decaying from a deregistration', () => {
    const wallet = [generator(false), base(true), base(false), base(false), base(false)];

    expect(planRegistration(wallet, enoughDust)).toEqual({ _tag: 'Register', utxos: [wallet[0]] });
  });

  test('should register an unregistered base UTxO when the generator is the only registered UTxO', () => {
    const wallet = [generator(true), base(false), base(false), base(false), base(false)];

    expect(planRegistration(wallet, 0n)).toEqual({ _tag: 'Register', utxos: [wallet[1]] });
  });

  test('should register the generator when it is unregistered, even though two other UTxOs are registered and the wallet holds Dust, because it is what keeps the wallet generating enough Dust to pay fees', () => {
    const wallet = [generator(false), base(true), base(true), base(false), base(false)];

    expect(planRegistration(wallet, enoughDust)).toEqual({ _tag: 'Register', utxos: [wallet[0]] });
  });

  test('should wait for Dust when two UTxOs are registered and the wallet has none yet', () => {
    const wallet = [generator(true), base(true), base(false), base(false), base(false)];

    expect(planRegistration(wallet, 0n)).toEqual({ _tag: 'WaitForDust' });
  });

  test('should do nothing when two UTxOs are registered and the wallet holds Dust', () => {
    const wallet = [generator(true), base(true), base(false), base(false), base(false)];

    expect(planRegistration(wallet, enoughDust)).toEqual({ _tag: 'Ready' });
  });
});

describe('planRegistration, with UTxOs below the base amount or too little Dust', () => {
  test('should register a base UTxO with the generator, never a smaller one', () => {
    const wallet = [generator(false), small(false), base(false), base(false), base(false), base(false)];

    expect(planRegistration(wallet, 0n)).toEqual({ _tag: 'Register', utxos: [wallet[0], wallet[2]] });
  });

  test('should wait for Dust while the wallet holds less than a fee needs, because a single Speck pays for nothing', () => {
    const wallet = [generator(true), base(true), base(false), base(false), base(false)];

    expect(planRegistration(wallet, MIN_DUST_FOR_FEES - 1n)).toEqual({ _tag: 'WaitForDust' });
  });
});

describe('readinessProblems', () => {
  test('should report nothing for a wallet that can serve both dust healthchecks', () => {
    const wallet = [generator(true), base(true), base(false), base(false), base(false)];

    expect(readinessProblems(wallet, enoughDust)).toEqual([]);
  });

  test('should report a wallet whose generator is not registered, even with two other UTxOs registered', () => {
    const wallet = [generator(false), base(true), base(true), base(false), base(false)];

    expect(readinessProblems(wallet, enoughDust)).toEqual([expect.stringMatching(/generator.*not registered/)]);
  });

  test('should report a registered wallet left short of unregistered UTxOs, and say a deregistration lets funding add them', () => {
    const wallet = [generator(true), base(true), base(true), base(true), base(false)];

    expect(readinessProblems(wallet, enoughDust)).toEqual([
      expect.stringMatching(/1 unregistered Night UTxO.*deregist/),
    ]);
  });
});

describe('readinessProblems, with UTxOs below the base amount or too little Dust', () => {
  test('should count only UTxOs of at least the base amount towards the five and the two unregistered', () => {
    const wallet = [generator(true), base(true), small(false), small(false), small(false)];

    expect(readinessProblems(wallet, enoughDust)).toEqual([
      expect.stringMatching(/^2 Night UTxOs/),
      expect.stringMatching(/^0 unregistered Night UTxOs/),
    ]);
  });

  test('should report too little Dust to pay fees', () => {
    const wallet = [generator(true), base(true), base(false), base(false), base(false)];

    expect(readinessProblems(wallet, MIN_DUST_FOR_FEES - 1n)).toEqual([expect.stringMatching(/Dust/)]);
  });
});

describe('registerWithRetries', () => {
  /** A registration that fails the given number of times before it succeeds, counting how often it was built. */
  const failing = (failures: number) => {
    const calls = { count: 0 };
    const register = () => {
      calls.count += 1;
      return calls.count <= failures
        ? Promise.reject(new Error(`shortfall ${calls.count}`))
        : Promise.resolve('recipe');
    };
    return { calls, register };
  };
  const waitOut = () => Promise.resolve();

  test('should build the registration at most three times, then fail saying how many attempts it made and why the last one failed', async () => {
    const { calls, register } = failing(Infinity);

    const outcome = registerWithRetries(register, waitOut, 3);

    await expect(outcome).rejects.toThrow(/3 attempts/);
    await expect(outcome).rejects.toHaveProperty('cause', expect.objectContaining({ message: 'shortfall 3' }));
    expect(calls.count).toBe(3);
  });

  test('should rethrow an error it cannot wait out without building the registration again', async () => {
    const { calls, register } = failing(Infinity);
    const notAShortfall = new Error('not a shortfall');

    await expect(registerWithRetries(register, () => Promise.reject(notAShortfall), 3)).rejects.toBe(notAShortfall);
    expect(calls.count).toBe(1);
  });

  test('should return the registration once a later attempt succeeds', async () => {
    const { calls, register } = failing(1);

    await expect(registerWithRetries(register, waitOut, 3)).resolves.toBe('recipe');
    expect(calls.count).toBe(2);
  });
});

describe('parseFundingEnvironment', () => {
  const seed = (n: number) => n.toString(16).padStart(64, '0');

  test('should read SEED as the funder, SEED2 as the target and SEED_STABLE as the stable wallet, an empty value counting as unset', () => {
    expect(parseFundingEnvironment({ SEED: seed(1), SEED2: seed(2), SEED_STABLE: '' })).toEqual(
      Either.right({ funder: seed(1), target: { _tag: 'Given', seed: seed(2) }, stable: undefined }),
    );
  });

  test.each(['1', 'TRUE', 'yes'])(
    'should refuse FUND_RANDOM_TARGET=%s, because a value read as false would silently fund SEED2 instead of a new wallet',
    (value) => {
      const parsed = parseFundingEnvironment({ SEED: seed(1), SEED2: seed(2), FUND_RANDOM_TARGET: value });

      expect(Either.isLeft(parsed) ? parsed.left : 'parsed without an error').toMatch(/FUND_RANDOM_TARGET/);
    },
  );

  test('should accept FUND_RANDOM_TARGET=false and fund SEED2', () => {
    expect(parseFundingEnvironment({ SEED: seed(1), SEED2: seed(2), FUND_RANDOM_TARGET: 'false' })).toEqual(
      Either.right({ funder: seed(1), target: { _tag: 'Given', seed: seed(2) }, stable: undefined }),
    );
  });

  test.each([
    ['SEED2 equal to SEED, so the wallet would pay itself', { SEED: seed(1), SEED2: seed(1) }],
    [
      'SEED_STABLE equal to SEED2, so the stable wallet would be over-funded by the first test',
      { SEED: seed(1), SEED2: seed(2), SEED_STABLE: seed(2) },
    ],
    [
      'SEED_STABLE equal to SEED, so the stable wallet would pay itself',
      { SEED: seed(1), SEED2: seed(2), SEED_STABLE: seed(1) },
    ],
  ])('should refuse %s', (_reason, env) => {
    const parsed = parseFundingEnvironment(env);

    expect(Either.isLeft(parsed) ? parsed.left : 'parsed without an error').toMatch(/must differ/);
  });
});

describe('planStableTopUp', () => {
  test('should send every balance that is short even when another is above target, and list the one above it', () => {
    const { unshielded, nativeToken1 } = STABLE_WALLET;
    const current = [
      { ...unshielded, held: unshielded.amount + 1n },
      { ...nativeToken1, held: 0n },
    ];

    expect(planStableTopUp(current)).toEqual({
      short: [{ ...nativeToken1, short: nativeToken1.amount }],
      over: [current[0]],
    });
  });
});
