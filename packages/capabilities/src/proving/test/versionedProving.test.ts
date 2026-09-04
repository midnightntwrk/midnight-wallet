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
import { type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { Cause, Effect, Either, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { fromV8ProvingProvider } from '../v8ProvingService.js';
import {
  ProvingConfigurationError,
  ProvingEpochMismatchError,
  resolveProvingBackends,
  UnsupportedProvingVersionError,
  type DefaultProvingConfiguration,
  type ProvingBackend,
  type ProvingBackends,
} from '../provingService.js';
import { makeDefaultProvingServices, makeDefaultVersionedProvingServiceEffect } from '../versionedProving.js';

const version = (value: bigint): ProtocolVersion.ProtocolVersion => ProtocolVersion.ProtocolVersion(value);
const FORK = version(2_000_000n);
const FORKS: ProtocolVersion.ForkSchedule = { v9: FORK };
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
    provers: {
      v8: { kind: 'server', url: unusedServer('pre-fork') },
      v9: { kind: 'server', url: unusedServer('post-fork') },
    },
  } as const;

  it('proves a transaction stamped below the fork with ledger-v8', async () => {
    const router = Either.getOrThrow(makeDefaultVersionedProvingServiceEffect(bothSides, FORKS));

    const proven = await Effect.runPromise(router.prove(aV8Transaction(), BEFORE_FORK));

    expect(proven).toBeInstanceOf(preForkLedger.Transaction);
    expect(proven).not.toBeInstanceOf(ledger.Transaction);
  });

  it('proves a transaction stamped at the fork with ledger-v9', async () => {
    const router = Either.getOrThrow(makeDefaultVersionedProvingServiceEffect(bothSides, FORKS));

    const proven = await Effect.runPromise(router.prove(aCurrentLedgerTransaction(), FORK));

    expect(proven).toBeInstanceOf(ledger.Transaction);
    expect(proven).not.toBeInstanceOf(preForkLedger.Transaction);
  });

  it('takes the range each backend serves from the fork schedule, and from nowhere else', () => {
    // The configuration names a backend per ledger version and says nothing about protocol versions; where one ledger
    // version ends and the next begins is the chain's fork schedule, stated once. Moving the boundary moves the ranges.
    const atTheNativeFork = Either.getOrThrow(makeDefaultProvingServices(bothSides, FORKS));
    expect(atTheNativeFork.entries.map((entry) => entry.range)).toStrictEqual([
      ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, FORK),
      ProtocolVersion.makeRange(FORK, ProtocolVersion.MaxSupportedVersion),
    ]);

    const atSeven = Either.getOrThrow(makeDefaultProvingServices(bothSides, { v9: version(7n) }));
    expect(atSeven.entries.map((entry) => entry.range)).toStrictEqual([
      ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, version(7n)),
      ProtocolVersion.makeRange(version(7n), ProtocolVersion.MaxSupportedVersion),
    ]);
  });

  it('drives the single-server shorthand with each ledger version on its own side of the fork', async () => {
    // One server for every version says nothing about ledger versions, and cannot: the two epochs frame their proving
    // requests differently. Registering the same URL once per side is what makes it mean the right thing twice.
    const services = Either.getOrThrow(makeDefaultProvingServices({ provingServerUrl: unusedServer('only') }, FORKS));

    expect(services.entries.map((entry) => entry.range)).toStrictEqual([
      ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, FORK),
      ProtocolVersion.makeRange(FORK, ProtocolVersion.MaxSupportedVersion),
    ]);

    const router = Either.getOrThrow(
      makeDefaultVersionedProvingServiceEffect({ provingServerUrl: unusedServer('only') }, FORKS),
    );
    expect(await Effect.runPromise(router.prove(aV8Transaction(), BEFORE_FORK))).toBeInstanceOf(
      preForkLedger.Transaction,
    );
    expect(await Effect.runPromise(router.prove(aCurrentLedgerTransaction(), FORK))).toBeInstanceOf(ledger.Transaction);
  });

  it('registers nothing below the fork when no ledger-v8 backend is named, and says so for a transaction stamped there', async () => {
    const postForkOnly = { provers: { v9: { kind: 'server', url: unusedServer('post-fork') } } } as const;

    const services = Either.getOrThrow(makeDefaultProvingServices(postForkOnly, FORKS));
    expect(services.entries.map((entry) => entry.range)).toStrictEqual([
      ProtocolVersion.makeRange(FORK, ProtocolVersion.MaxSupportedVersion),
    ]);

    const router = Either.getOrThrow(makeDefaultVersionedProvingServiceEffect(postForkOnly, FORKS));
    const error = await failureOf(router.prove(aV8Transaction(), BEFORE_FORK));
    expect(error).toBeInstanceOf(UnsupportedProvingVersionError);
    expect((error as UnsupportedProvingVersionError).protocolVersion).toStrictEqual(BEFORE_FORK);
  });

  it('registers a single ledger-v9 epoch for a chain whose boundary is at or below the minimum supported version', async () => {
    // Such a chain has no history ledger-v8 authored, so a ledger-v8 backend has no epoch to serve, whether it was named
    // outright or implied by the single-server shorthand.
    const bornOnV9: ProtocolVersion.ForkSchedule = { v9: ProtocolVersion.MinSupportedVersion };
    const wholeTimeline = [
      ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, ProtocolVersion.MaxSupportedVersion),
    ];

    expect(
      Either.getOrThrow(makeDefaultProvingServices(bothSides, bornOnV9)).entries.map((entry) => entry.range),
    ).toStrictEqual(wholeTimeline);
    expect(
      Either.getOrThrow(makeDefaultProvingServices({ provingServerUrl: unusedServer('only') }, bornOnV9)).entries.map(
        (entry) => entry.range,
      ),
    ).toStrictEqual(wholeTimeline);

    const router = Either.getOrThrow(makeDefaultVersionedProvingServiceEffect(bothSides, bornOnV9));
    expect(await Effect.runPromise(router.prove(aCurrentLedgerTransaction(), BEFORE_FORK))).toBeInstanceOf(
      ledger.Transaction,
    );
  });

  it('refuses a transaction from the other side of the boundary, naming the epoch the backend serves', async () => {
    const router = Either.getOrThrow(makeDefaultVersionedProvingServiceEffect(bothSides, FORKS));

    const error = await failureOf(router.prove(aCurrentLedgerTransaction(), BEFORE_FORK));

    expect(error).toBeInstanceOf(ProvingEpochMismatchError);
    expect((error as ProvingEpochMismatchError).epoch).toStrictEqual(
      ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, FORK),
    );
  });

  it('refuses a ledger-v8 transaction handed to ledger-v9, naming the epoch that backend serves', async () => {
    const router = Either.getOrThrow(makeDefaultVersionedProvingServiceEffect(bothSides, FORKS));

    const error = await failureOf(router.prove(aV8Transaction(), FORK));

    expect(error).toBeInstanceOf(ProvingEpochMismatchError);
    expect((error as ProvingEpochMismatchError).epoch).toStrictEqual(
      ProtocolVersion.makeRange(FORK, ProtocolVersion.MaxSupportedVersion),
    );
  });
});

describe('Reading which backend proves for which ledger version', () => {
  it('reads the backends keyed by ledger version as given', () => {
    const backends = Either.getOrThrow(
      resolveProvingBackends({
        provers: { v8: { kind: 'server', url: unusedServer('pre') }, v9: { kind: 'wasm' } },
      }),
    );

    expect(backends).toStrictEqual({ v8: { kind: 'server', url: unusedServer('pre') }, v9: { kind: 'wasm' } });
  });

  it('reads the single-server shorthand as that server for every ledger version', () => {
    const backends = Either.getOrThrow(resolveProvingBackends({ provingServerUrl: unusedServer('only') }));

    expect(backends).toStrictEqual({
      v8: { kind: 'server', url: unusedServer('only') },
      v9: { kind: 'server', url: unusedServer('only') },
    });
  });

  it('prefers the backends keyed by ledger version over the single-server shorthand', () => {
    const backends = Either.getOrThrow(
      resolveProvingBackends({
        provingServerUrl: unusedServer('ignored'),
        provers: { v9: { kind: 'server', url: unusedServer('named') } },
      }),
    );

    expect(backends).toStrictEqual({ v9: { kind: 'server', url: unusedServer('named') } });
  });

  it('refuses a configuration that names no backend at all', () => {
    const failure = resolveProvingBackends({});

    expect(Either.isLeft(failure)).toBe(true);
    expect(Either.getLeft(failure).pipe(Option.getOrThrow)).toBeInstanceOf(ProvingConfigurationError);
  });

  it('keys the backends the way the fork schedule is keyed, plus the ledger version the schedule leaves implicit', () => {
    // The two maps must not be able to drift: every ledger version the schedule can place a boundary for is one a
    // backend can be named for, and ledger-v8, which begins at the minimum supported version, is the one key beyond.
    type _1 = Expect<Equal<Exclude<keyof ProvingBackends, 'v8'>, keyof ProtocolVersion.ForkSchedule>>;
  });

  it('requires the newest ledger version to have a backend and leaves the older one optional', () => {
    type _1 = Expect<Equal<ProvingBackends['v9'], ProvingBackend>>;
    type _2 = Expect<Equal<Pick<ProvingBackends, 'v8'>, { readonly v8?: ProvingBackend }>>;
  });

  it('no longer takes backends keyed by the protocol version each starts serving', () => {
    type _1 = Expect<Equal<'provingServers' extends keyof DefaultProvingConfiguration ? true : false, false>>;
    type _2 = Expect<Equal<DefaultProvingConfiguration['provers'], ProvingBackends | undefined>>;
  });
});
