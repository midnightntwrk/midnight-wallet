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
 * The two sides of a protocol boundary are named by version, never by position; see "Naming the two sides of a fork" in
 * CLAUDE.md.
 *
 * @remarks
 *   Ledger material is `V8`/`V9` and wallet variants are `V1`/`V2`, on the root barrel and on every subpath. What is
 *   pinned here is the runtime-visible half of that rule: the names the public surface offers, and the names it no
 *   longer does. The type-level half — the variant types and the type parameters that carry each one's sync update — is
 *   held by the declarations at the bottom, which `yarn typecheck` reads and Vitest does not.
 */
import * as validation from '@midnightntwrk/wallet-sdk-capabilities/validation';
import { describe, expect, it } from 'vitest';
import * as proving from '../capabilities/proving.js';
import * as simulation from '../capabilities/simulation.js';
import * as sdk from '../index.js';

/** A name that says which side of a fork it is on by position rather than by version. */
const positional = /pre[-_]?fork|post[-_]?fork|before[-_]?fork|after[-_]?fork/i;

const positionalNamesOf = (names: readonly string[]): readonly string[] =>
  names.filter((name) => positional.test(name));

describe('what the public surface calls the two sides of a protocol boundary', () => {
  it('names the dust parameter conversions by the ledger version whose object they return', () => {
    expect(Object.keys(sdk)).toEqual(expect.arrayContaining(['asV8DustParameters', 'asV9DustParameters']));
  });

  it("names the public key narrowing by the variant whose type it returns, since that is the v1 tree's own", () => {
    expect(Object.keys(sdk)).toContain('asV1PublicKey');
  });

  it('names the ledger-v9 proving backends the way the ledger-v8 ones are already named', () => {
    expect(Object.keys(proving)).toEqual(
      expect.arrayContaining([
        'fromV8ProvingProviderEffect',
        'fromV9ProvingProviderEffect',
        'fromV8ProvingProvider',
        'fromV9ProvingProvider',
        'makeV8ServerProvingServiceEffect',
        'makeV9ServerProvingServiceEffect',
        'makeV8WasmProvingServiceEffect',
        'makeV9WasmProvingServiceEffect',
        'makeV9ServerProvingService',
        'makeV9WasmProvingService',
      ]),
    );
  });

  it('no longer offers the ledger-v9 backends under names that leave the version unsaid', () => {
    const unsaid = [
      'fromProvingProviderEffect',
      'fromProvingProvider',
      'makeServerProvingServiceEffect',
      'makeWasmProvingServiceEffect',
      'makeServerProvingService',
      'makeWasmProvingService',
    ];

    expect(Object.keys(proving).filter((name) => unsaid.includes(name))).toStrictEqual([]);
  });

  it("names each ledger version's validator by version, the router by neither", () => {
    expect(Object.keys(validation)).toEqual(
      expect.arrayContaining([
        'v8WellFormedCheck',
        'v9WellFormedCheck',
        'makeV8ValidationServiceEffect',
        'makeV9ValidationServiceEffect',
        'makeV9ValidationService',
        'makeDefaultVersionedValidationServiceEffect',
        'makeDefaultVersionedValidationService',
      ]),
    );
    expect(
      Object.keys(validation).filter((name) =>
        ['makeDefaultValidationServiceEffect', 'makeDefaultValidationService'].includes(name),
      ),
    ).toStrictEqual([]);
  });

  it('names the two chains of a fork simulator by ledger version', () => {
    const members = Object.getOwnPropertyNames(simulation.ForkSimulator.prototype);

    expect(members).toEqual(expect.arrayContaining(['v9', 'awaitV9', 'advanceToFork']));
    expect(positionalNamesOf(members)).toStrictEqual([]);
  });

  it('keys the signature error to a module named for ledger-v8, whose one scheme it is about', () => {
    const error = new sdk.UnsupportedSignatureKindError({ message: 'a scheme ledger-v8 does not have', kind: 'ecdsa' });

    expect(error._tag).toBe(
      '@midnightntwrk/wallet-sdk-capabilities/signatures/v8Signatures/UnsupportedSignatureKindError',
    );
  });

  it('offers no positional name on the root, proving, validation or simulation surfaces', () => {
    const offered = [
      ...Object.keys(sdk),
      ...Object.keys(proving),
      ...Object.keys(validation),
      ...Object.keys(simulation),
    ];

    expect(positionalNamesOf(offered)).toStrictEqual([]);
  });
});

// The type-level pins. Each variant type is named by variant ordinal, and a forking wallet's two sync updates are
// carried by type parameters that say which variant each belongs to. Unused on purpose: `yarn typecheck` is the test.
type _V1Shielded = sdk.V1ShieldedVariant<unknown>;
type _V2Shielded = sdk.V2ShieldedVariant<unknown>;
type _V1Dust = sdk.V1DustVariant<unknown>;
type _V2Dust = sdk.V2DustVariant<unknown>;
type _V1Unshielded = sdk.V1UnshieldedVariant<unknown>;
type _V2Unshielded = sdk.V2UnshieldedVariant<unknown>;
