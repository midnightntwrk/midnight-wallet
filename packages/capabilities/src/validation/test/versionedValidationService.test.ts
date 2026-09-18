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
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Cause, Effect, Either, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  makeVersionedValidationServiceEffect,
  singleVersionValidationServiceEffect,
  UnsupportedValidationVersionError,
  WellFormedError,
  wrapVersionedValidationService,
  type ValidationServiceEffect,
} from '../validationService.js';

const version = (value: bigint): ProtocolVersion.ProtocolVersion => ProtocolVersion.ProtocolVersion(value);
const FORK = version(2_000_000n);

const NO_STRICTNESS = { enforceBalancing: false, verifySignatures: false, enforceLimits: false } as const;

/**
 * A validator that reports which one answered, through the failure channel, so routing is observable without a ledger.
 * Failing is how a validator speaks at all — a pass returns nothing — so this is the only pure way to see the choice.
 */
const labelled = (label: string): ValidationServiceEffect<string, string> => ({
  validateTx: (transaction) => Effect.fail(new WellFormedError({ cause: `${label}:${transaction}` })),
});

const registryOf = (
  ...activations: readonly {
    sinceVersion: ProtocolVersion.ProtocolVersion;
    value: ValidationServiceEffect<string, string>;
  }[]
) => Either.getOrThrow(ProtocolVersion.makeRegistryFromActivations(activations));

const failureOf = async <A, E>(effect: Effect.Effect<A, E>): Promise<E> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) throw new Error('expected the effect to fail');
  return Option.getOrThrow(Cause.failureOption(exit.cause));
};

describe('Routing a transaction to the validator for the version it was authored for', () => {
  const router = makeVersionedValidationServiceEffect(
    registryOf(
      { sinceVersion: ProtocolVersion.MinSupportedVersion, value: labelled('v8') },
      { sinceVersion: FORK, value: labelled('v9') },
    ),
  );

  it('validates with the validator registered for the version the transaction was authored for', async () => {
    const v8Failure = await failureOf(router.validateTx('tx', version(17n), { flags: NO_STRICTNESS }));
    const v9Failure = await failureOf(router.validateTx('tx', FORK, { flags: NO_STRICTNESS }));

    expect((v8Failure as WellFormedError).cause).toBe('v8:tx');
    expect((v9Failure as WellFormedError).cause).toBe('v9:tx');
  });

  it('routes on the stamp the author gave, not on where the chain has since got to', async () => {
    // A transaction's bytes were fixed at the version it was authored for. Well-formedness asks whether *that* ledger
    // would accept them, so a fork landing between authoring and validation cannot change which validator answers.
    const error = await failureOf(router.validateTx('authored-before', version(1n), { flags: NO_STRICTNESS }));

    expect((error as WellFormedError).cause).toBe('v8:authored-before');
  });

  it('refuses a version no validator is registered for, naming that version', async () => {
    const v9Only = makeVersionedValidationServiceEffect(registryOf({ sinceVersion: FORK, value: labelled('v9') }));

    const error = await failureOf(v9Only.validateTx('tx', version(1n), { flags: NO_STRICTNESS }));

    expect(error).toBeInstanceOf(UnsupportedValidationVersionError);
    expect((error as UnsupportedValidationVersionError).protocolVersion).toStrictEqual(version(1n));
  });

  it('lets a single-version validator answer for every version, explicitly', async () => {
    const anywhere = singleVersionValidationServiceEffect(labelled('only'));

    const atZero = await failureOf(anywhere.validateTx('tx', version(0n), { flags: NO_STRICTNESS }));
    const atFork = await failureOf(anywhere.validateTx('tx', FORK, { flags: NO_STRICTNESS }));

    expect((atZero as WellFormedError).cause).toBe('only:tx');
    expect((atFork as WellFormedError).cause).toBe('only:tx');
  });

  it('rejects the promise with the typed error itself, not a wrapper around it', async () => {
    const promising = wrapVersionedValidationService(
      makeVersionedValidationServiceEffect(registryOf({ sinceVersion: FORK, value: labelled('v9') })),
    );

    await expect(promising.validateTx('tx', version(1n), { flags: NO_STRICTNESS })).rejects.toBeInstanceOf(
      UnsupportedValidationVersionError,
    );
  });
});
