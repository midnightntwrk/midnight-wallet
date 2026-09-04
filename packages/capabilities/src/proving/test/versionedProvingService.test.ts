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
  makeVersionedProvingServiceEffect,
  singleVersionProvingServiceEffect,
  UnsupportedProvingVersionError,
  type ProvingServiceEffect,
} from '../provingService.js';

const version = (value: bigint): ProtocolVersion.ProtocolVersion => ProtocolVersion.ProtocolVersion(value);
const FORK = version(2_000_000n);

/** A prover that reports which backend answered, so routing is observable without a proof server. */
const labelled = (label: string): ProvingServiceEffect<string, string> => ({
  prove: (transaction) => Effect.succeed(`${label}:${transaction}`),
});

const registryOf = (
  ...activations: readonly {
    sinceVersion: ProtocolVersion.ProtocolVersion;
    value: ProvingServiceEffect<string, string>;
  }[]
) => Either.getOrThrow(ProtocolVersion.makeRegistryFromActivations(activations));

const failureOf = async <A, E>(effect: Effect.Effect<A, E>): Promise<E> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) throw new Error('expected the effect to fail');
  return Option.getOrThrow(Cause.failureOption(exit.cause));
};

describe('Routing a transaction to the prover for the version it was built for', () => {
  const router = makeVersionedProvingServiceEffect(
    registryOf(
      { sinceVersion: ProtocolVersion.MinSupportedVersion, value: labelled('pre-fork') },
      { sinceVersion: FORK, value: labelled('post-fork') },
    ),
  );

  it('proves with the backend registered for the version the transaction was built for', async () => {
    await expect(Effect.runPromise(router.prove('tx', version(17n)))).resolves.toBe('pre-fork:tx');
    await expect(Effect.runPromise(router.prove('tx', FORK))).resolves.toBe('post-fork:tx');
  });

  it('routes on the stamp, not on where the chain has since got to', async () => {
    // The fork can land between balancing and proving. The transaction's own bytes are what the prover has to be able
    // to read, and those were fixed when it was built — so the stamp decides, and nothing else is consulted.
    await expect(Effect.runPromise(router.prove('built-before', version(1n)))).resolves.toBe('pre-fork:built-before');
  });

  it('refuses a version no prover is registered for, naming that version', async () => {
    const postForkOnly = makeVersionedProvingServiceEffect(registryOf({ sinceVersion: FORK, value: labelled('wasm') }));

    const error = await failureOf(postForkOnly.prove('tx', version(1n)));

    expect(error).toBeInstanceOf(UnsupportedProvingVersionError);
    expect((error as UnsupportedProvingVersionError).protocolVersion).toStrictEqual(version(1n));
  });

  it('lets a single-version backend answer for every version, explicitly', async () => {
    const anywhere = singleVersionProvingServiceEffect(labelled('only'));

    await expect(Effect.runPromise(anywhere.prove('tx', version(0n)))).resolves.toBe('only:tx');
    await expect(Effect.runPromise(anywhere.prove('tx', FORK))).resolves.toBe('only:tx');
  });
});
