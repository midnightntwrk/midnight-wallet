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
import { describe, expect, test } from 'vitest';
import {
  BASE_AMOUNT,
  DUST_GENERATOR_AMOUNT,
  type NightCoin,
  planNightTopUp,
  planRegistration,
  readinessProblems,
} from './fundingPlan.js';

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

describe('planRegistration', () => {
  test('should register the generator and one base UTxO of a wallet with nothing registered', () => {
    const wallet = [generator(false), base(false), base(false), base(false), base(false)];

    expect(planRegistration(wallet, 0n)).toEqual({ _tag: 'Register', utxos: [wallet[0], wallet[1]] });
  });

  test('should register the unregistered generator when only one UTxO is registered, even though the wallet holds Dust, because that Dust may be decaying from a deregistration', () => {
    const wallet = [generator(false), base(true), base(false), base(false), base(false)];

    expect(planRegistration(wallet, 5n)).toEqual({ _tag: 'Register', utxos: [wallet[0]] });
  });

  test('should register an unregistered base UTxO when the generator is the only registered UTxO', () => {
    const wallet = [generator(true), base(false), base(false), base(false), base(false)];

    expect(planRegistration(wallet, 0n)).toEqual({ _tag: 'Register', utxos: [wallet[1]] });
  });

  test('should wait for Dust when two UTxOs are registered and the wallet has none yet', () => {
    const wallet = [generator(true), base(true), base(false), base(false), base(false)];

    expect(planRegistration(wallet, 0n)).toEqual({ _tag: 'WaitForDust' });
  });

  test('should do nothing when two UTxOs are registered and the wallet holds Dust', () => {
    const wallet = [generator(true), base(true), base(false), base(false), base(false)];

    expect(planRegistration(wallet, 5n)).toEqual({ _tag: 'Ready' });
  });
});

describe('readinessProblems', () => {
  test('should report nothing for a wallet that can serve both dust healthchecks', () => {
    const wallet = [generator(true), base(true), base(false), base(false), base(false)];

    expect(readinessProblems(wallet, 5n)).toEqual([]);
  });

  test('should report a registered wallet left short of unregistered UTxOs, and say a deregistration lets funding add them', () => {
    const wallet = [generator(true), base(true), base(true), base(true), base(false)];

    expect(readinessProblems(wallet, 5n)).toEqual([expect.stringMatching(/1 unregistered Night UTxO.*deregist/)]);
  });
});
