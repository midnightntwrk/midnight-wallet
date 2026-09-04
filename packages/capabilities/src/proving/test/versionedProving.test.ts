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
import * as preForkLedger from '@midnight-ntwrk/ledger-v8';
import * as ledger from '@midnightntwrk/ledger-v9';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Cause, Effect, Either, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { fromV8ProvingProvider } from '../v8ProvingService.js';
import { ProvingConfigurationError, ProvingEpochMismatchError, resolveProvingBackends } from '../provingService.js';
import { makeDefaultProvingServices, makeDefaultVersionedProvingServiceEffect } from '../versionedProving.js';

const version = (value: bigint): ProtocolVersion.ProtocolVersion => ProtocolVersion.ProtocolVersion(value);
const FORK = version(2_000_000n);
const BEFORE_FORK = version(5n);

/**
 * A proving provider that answers with nothing.
 *
 * @remarks
 *   Enough for every transaction in this file: none of them contains anything that has to be proved, so the ledger never
 *   asks. What is under test is which ledger version drives the proving loop, not the proofs it would produce.
 */
const aFakeProvingProvider: preForkLedger.ProvingProvider = {
  check: () => Promise.resolve([]),
  prove: () => Promise.resolve(new Uint8Array(0)),
};

/** A ledger-v8 transaction with nothing in it that needs a proof. */
const aV8Transaction = (): preForkLedger.UnprovenTransaction =>
  preForkLedger.Transaction.fromParts(
    'undeployed',
    undefined,
    undefined,
    preForkLedger.Intent.new(new Date(Date.now() + 3_600_000)),
  );

/** A current-ledger transaction with nothing in it that needs a proof. */
const aCurrentLedgerTransaction = (): ledger.UnprovenTransaction =>
  ledger.Transaction.fromParts('undeployed', undefined, undefined, ledger.Intent.new(new Date(Date.now() + 3_600_000)));

const failureOf = async <A, E>(effect: Effect.Effect<A, E>): Promise<E> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) throw new Error('expected the effect to fail');
  return Option.getOrThrow(Cause.failureOption(exit.cause));
};

/** A URL no test ever connects to: nothing in this file has anything to prove, so no request is ever made. */
const unusedServer = (host: string) => new URL(`http://${host}:6300`);

describe('Proving with ledger-v8', () => {
  it("drives the transaction with ledger-v8, and hands back that ledger version's transaction", async () => {
    const service = fromV8ProvingProvider(aFakeProvingProvider);

    const proven = await Effect.runPromise(service.prove(aV8Transaction()));

    expect(proven).toBeInstanceOf(preForkLedger.Transaction);
    expect(proven).not.toBeInstanceOf(ledger.Transaction);
  });
});

describe('Composing proving backends either side of the protocol boundary', () => {
  const bothSides = {
    provers: [
      { sinceVersion: ProtocolVersion.MinSupportedVersion, backend: { kind: 'server', url: unusedServer('pre-fork') } },
      { sinceVersion: FORK, backend: { kind: 'server', url: unusedServer('post-fork') } },
    ],
  } as const;

  it('proves a transaction stamped below the fork with ledger-v8', async () => {
    const router = Either.getOrThrow(makeDefaultVersionedProvingServiceEffect(bothSides, FORK));

    const proven = await Effect.runPromise(router.prove(aV8Transaction(), BEFORE_FORK));

    expect(proven).toBeInstanceOf(preForkLedger.Transaction);
    expect(proven).not.toBeInstanceOf(ledger.Transaction);
  });

  it('proves a transaction stamped at the fork with ledger-v9', async () => {
    const router = Either.getOrThrow(makeDefaultVersionedProvingServiceEffect(bothSides, FORK));

    const proven = await Effect.runPromise(router.prove(aCurrentLedgerTransaction(), FORK));

    expect(proven).toBeInstanceOf(ledger.Transaction);
    expect(proven).not.toBeInstanceOf(preForkLedger.Transaction);
  });

  it('splits a backend whose range straddles the fork, so each side is driven by its own ledger', async () => {
    // One server for every version says nothing about ledger versions, and cannot: the two epochs frame their proving
    // requests differently. Splitting the range at the boundary is what makes the same URL mean the right thing twice.
    const services = Either.getOrThrow(makeDefaultProvingServices({ provingServerUrl: unusedServer('only') }, FORK));

    expect(services.entries.map((entry) => entry.range)).toStrictEqual([
      ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, FORK),
      ProtocolVersion.makeRange(FORK, ProtocolVersion.MaxSupportedVersion),
    ]);

    const router = Either.getOrThrow(
      makeDefaultVersionedProvingServiceEffect({ provingServerUrl: unusedServer('only') }, FORK),
    );
    expect(await Effect.runPromise(router.prove(aV8Transaction(), BEFORE_FORK))).toBeInstanceOf(
      preForkLedger.Transaction,
    );
    expect(await Effect.runPromise(router.prove(aCurrentLedgerTransaction(), FORK))).toBeInstanceOf(ledger.Transaction);
  });

  it('registers a single epoch for a chain whose boundary is at or below the minimum supported version', async () => {
    const services = Either.getOrThrow(
      makeDefaultProvingServices({ provingServerUrl: unusedServer('only') }, ProtocolVersion.MinSupportedVersion),
    );

    expect(services.entries.map((entry) => entry.range)).toStrictEqual([
      ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, ProtocolVersion.MaxSupportedVersion),
    ]);

    const router = Either.getOrThrow(
      makeDefaultVersionedProvingServiceEffect(
        { provingServerUrl: unusedServer('only') },
        ProtocolVersion.MinSupportedVersion,
      ),
    );
    expect(await Effect.runPromise(router.prove(aCurrentLedgerTransaction(), BEFORE_FORK))).toBeInstanceOf(
      ledger.Transaction,
    );
  });

  it('refuses a transaction from the other side of the boundary, naming the epoch the backend serves', async () => {
    const router = Either.getOrThrow(makeDefaultVersionedProvingServiceEffect(bothSides, FORK));

    const error = await failureOf(router.prove(aCurrentLedgerTransaction(), BEFORE_FORK));

    expect(error).toBeInstanceOf(ProvingEpochMismatchError);
    expect((error as ProvingEpochMismatchError).epoch).toStrictEqual(
      ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, FORK),
    );
  });

  it('refuses a ledger-v8 transaction handed to ledger-v9, naming the epoch that backend serves', async () => {
    const router = Either.getOrThrow(makeDefaultVersionedProvingServiceEffect(bothSides, FORK));

    const error = await failureOf(router.prove(aV8Transaction(), FORK));

    expect(error).toBeInstanceOf(ProvingEpochMismatchError);
    expect((error as ProvingEpochMismatchError).epoch).toStrictEqual(
      ProtocolVersion.makeRange(FORK, ProtocolVersion.MaxSupportedVersion),
    );
  });
});

describe('Reading which backend serves which protocol version', () => {
  it('reads the version-keyed backends as the versions they each start serving', () => {
    const registry = Either.getOrThrow(
      resolveProvingBackends({
        provers: [
          { sinceVersion: ProtocolVersion.MinSupportedVersion, backend: { kind: 'server', url: unusedServer('pre') } },
          { sinceVersion: FORK, backend: { kind: 'wasm' } },
        ],
      }),
    );

    expect(ProtocolVersion.select(registry, BEFORE_FORK)).toStrictEqual(
      Option.some({ kind: 'server', url: unusedServer('pre') }),
    );
    expect(ProtocolVersion.select(registry, FORK)).toStrictEqual(Option.some({ kind: 'wasm' }));
  });

  it('prefers the version-keyed backends over both server shorthands', () => {
    const registry = Either.getOrThrow(
      resolveProvingBackends({
        provingServerUrl: unusedServer('ignored'),
        provingServers: [{ sinceVersion: ProtocolVersion.MinSupportedVersion, url: unusedServer('also-ignored') }],
        provers: [
          {
            sinceVersion: ProtocolVersion.MinSupportedVersion,
            backend: { kind: 'server', url: unusedServer('named') },
          },
        ],
      }),
    );

    expect(ProtocolVersion.select(registry, FORK)).toStrictEqual(
      Option.some({ kind: 'server', url: unusedServer('named') }),
    );
  });

  it('prefers the version-keyed server list over the single-server shorthand', () => {
    const registry = Either.getOrThrow(
      resolveProvingBackends({
        provingServerUrl: unusedServer('ignored'),
        provingServers: [{ sinceVersion: ProtocolVersion.MinSupportedVersion, url: unusedServer('listed') }],
      }),
    );

    expect(ProtocolVersion.select(registry, FORK)).toStrictEqual(
      Option.some({ kind: 'server', url: unusedServer('listed') }),
    );
  });

  it('reads the single-server shorthand as one server for every version', () => {
    const registry = Either.getOrThrow(resolveProvingBackends({ provingServerUrl: unusedServer('only') }));

    expect(ProtocolVersion.select(registry, ProtocolVersion.MinSupportedVersion)).toStrictEqual(
      Option.some({ kind: 'server', url: unusedServer('only') }),
    );
  });

  it('refuses a configuration that names no backend at all', () => {
    const failure = resolveProvingBackends({});

    expect(Either.isLeft(failure)).toBe(true);
    expect(Either.getLeft(failure).pipe(Option.getOrThrow)).toBeInstanceOf(ProvingConfigurationError);
  });

  it('refuses backends that are not in ascending version order', () => {
    const failure = resolveProvingBackends({
      provers: [
        { sinceVersion: FORK, backend: { kind: 'server', url: unusedServer('later') } },
        {
          sinceVersion: ProtocolVersion.MinSupportedVersion,
          backend: { kind: 'server', url: unusedServer('earlier') },
        },
      ],
    });

    expect(Either.isLeft(failure)).toBe(true);
    expect(Either.getLeft(failure).pipe(Option.getOrThrow)).toBeInstanceOf(ProvingConfigurationError);
  });

  it('refuses an empty list of backends, rather than reading it as no configuration at all', () => {
    expect(Either.isLeft(makeDefaultProvingServices({ provers: [] }, FORK))).toBe(true);
  });
});
