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
 * Proving for an SDK that spans a protocol boundary: one backend per ledger version, chosen by the version a
 * transaction was built for.
 *
 * @remarks
 *   The routing already existed and the backends already existed; what this module supplies is the only thing neither
 *   could: the registration that says which range of protocol versions each backend answers for, taken from the same
 *   fork schedule the wallets are built with. Written the same way validation's `versionedValidation.ts` is, because it
 *   is the same problem.
 */
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, Either, Option } from 'effect';
import {
  makeV8ServerProvingServiceEffect,
  makeV8WasmProvingServiceEffect,
  type V8UnboundTransaction,
  type V8UnprovenTransaction,
} from './v8ProvingService.js';
import {
  makeV9ServerProvingServiceEffect,
  makeVersionedProvingServiceEffect,
  makeV9WasmProvingServiceEffect,
  ProvingEpochMismatchError,
  resolveProvingBackends,
  wrapVersionedEffectService,
  type DefaultProvingConfiguration,
  type ProvingBackend,
  type ProvingConfigurationError,
  type ProvingServiceEffect,
  type ProvingServices,
  type V9UnboundTransaction,
  type VersionedProvingService,
  type VersionedProvingServiceEffect,
  type WasmProvingConfiguration,
} from './provingService.js';

/**
 * Every unproven transaction either ledger version can be asked to prove.
 *
 * @remarks
 *   A genuine union: the two ledger versions' transaction types are nominally distinct, so a caller holding one of them
 *   is holding something the other version's backend provably cannot read.
 */
/** Ledger-v9's unproven transaction, named for symmetry with {@link V8UnprovenTransaction}. */
export type V9UnprovenTransaction = ledgerV9.UnprovenTransaction;

export type AnyVersionUnprovenTransaction = V9UnprovenTransaction | V8UnprovenTransaction;

/** Every proved-but-unbound transaction either ledger version can hand back. */
export type AnyVersionUnboundTransaction = V9UnboundTransaction | V8UnboundTransaction;

/** A backend registered in a two-version registry, whichever ledger version it was written against. */
export type VersionProvingServiceEffect = ProvingServiceEffect<
  AnyVersionUnboundTransaction,
  AnyVersionUnprovenTransaction
>;

/**
 * Narrows a backend written against one ledger version to the union the registry is keyed by.
 *
 * @remarks
 *   The router has already chosen this backend by the version stamped on the transaction, so the check is a restatement
 *   of that choice rather than a second one — but it is where a transaction that does not belong is refused rather than
 *   handed to a ledger that cannot read it. What comes back from a wasm-bindgen boundary handed a foreign object is not
 *   an error anyone can act on; this is.
 * @param service The backend, written against one ledger version.
 * @param isOwn Whether a transaction is that ledger version's.
 * @param epoch The range of protocol versions this backend answers for.
 * @returns The same backend, in terms of the union.
 */
const onlyFrom = <TUnproven extends AnyVersionUnprovenTransaction, TUnbound extends AnyVersionUnboundTransaction>(
  service: ProvingServiceEffect<TUnbound, TUnproven>,
  isOwn: (transaction: AnyVersionUnprovenTransaction) => transaction is TUnproven,
  epoch: ProtocolVersion.ProtocolVersion.Range,
): VersionProvingServiceEffect => ({
  prove: (transaction) =>
    isOwn(transaction)
      ? service.prove(transaction)
      : Effect.fail(
          new ProvingEpochMismatchError({
            message: `The proving backend registered for protocol versions [${epoch[0]}, ${epoch[1]}) was handed a transaction built by the other ledger version.`,
            epoch,
          }),
        ),
});

const isV8Transaction = (transaction: AnyVersionUnprovenTransaction): transaction is V8UnprovenTransaction =>
  transaction instanceof ledgerV8.Transaction;

const isV9Transaction = (transaction: AnyVersionUnprovenTransaction): transaction is ledgerV9.UnprovenTransaction =>
  transaction instanceof ledgerV9.Transaction;

/** The in-process backend's configuration, with a key material override only when one was named. */
const wasmConfigurationOf = (backend: Extract<ProvingBackend, { kind: 'wasm' }>): WasmProvingConfiguration =>
  backend.keyMaterialProvider === undefined ? {} : { keyMaterialProvider: backend.keyMaterialProvider };

/** Builds the backend a description names, driven by ledger-v8, for the epoch below `forks.v9`. */
const makeV8Backend = (
  backend: ProvingBackend,
  epoch: ProtocolVersion.ProtocolVersion.Range,
): VersionProvingServiceEffect =>
  onlyFrom(
    backend.kind === 'server'
      ? makeV8ServerProvingServiceEffect({ provingServerUrl: backend.url })
      : makeV8WasmProvingServiceEffect(wasmConfigurationOf(backend)),
    isV8Transaction,
    epoch,
  );

/** Builds the backend a description names, driven by ledger-v9, for the epoch from `forks.v9`. */
const makeV9Backend = (
  backend: ProvingBackend,
  epoch: ProtocolVersion.ProtocolVersion.Range,
): VersionProvingServiceEffect =>
  onlyFrom(
    backend.kind === 'server'
      ? makeV9ServerProvingServiceEffect({ provingServerUrl: backend.url })
      : makeV9WasmProvingServiceEffect(wasmConfigurationOf(backend)),
    isV9Transaction,
    epoch,
  );

/**
 * The range of protocol versions each ledger version reads on a chain, from where the chain says the hand-over is.
 *
 * @remarks
 *   A chain whose boundary is at or below the minimum supported version has no history ledger-v8 authored, so there is no
 *   ledger-v8 epoch on it and a ledger-v8 backend has nothing to serve.
 */
const epochsOf = (forks: ProtocolVersion.ForkSchedule) => ({
  v8:
    forks.v9 > ProtocolVersion.MinSupportedVersion
      ? Option.some(ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, forks.v9))
      : Option.none(),
  v9: ProtocolVersion.epochOf(forks.v9, forks.v9),
});

/**
 * Registers a proving backend either side of the protocol boundary.
 *
 * @remarks
 *   The configuration names a backend per ledger version and the fork schedule says where each ledger version begins; the
 *   range a backend serves is the meeting of the two, computed here and nowhere else, so the wallets and their provers
 *   cannot place the boundary differently.
 * @param configuration The proving configuration.
 * @param forks Where each ledger version begins on the chain.
 * @returns The backends and the version ranges they serve, or the reason the configuration names none.
 */
export const makeDefaultProvingServices = (
  configuration: DefaultProvingConfiguration,
  forks: ProtocolVersion.ForkSchedule,
): Either.Either<
  ProvingServices<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>,
  ProvingConfigurationError
> =>
  resolveProvingBackends(configuration).pipe(
    Either.map((backends) => {
      const epochs = epochsOf(forks);
      const v8Entry = Option.all([Option.fromNullable(backends.v8), epochs.v8]).pipe(
        Option.map(([backend, range]) => ({ range, value: makeV8Backend(backend, range) })),
      );
      return {
        entries: [...Option.toArray(v8Entry), { range: epochs.v9, value: makeV9Backend(backends.v9, epochs.v9) }],
      };
    }),
  );

/**
 * Builds the version-routed proving service an SDK spanning a protocol boundary proves with.
 *
 * @param configuration The proving configuration.
 * @param forks Where each ledger version begins on the chain.
 * @returns A proving service that routes on the version a transaction was built for, or the reason the configuration
 *   names no backend.
 */
export const makeDefaultVersionedProvingServiceEffect = (
  configuration: DefaultProvingConfiguration,
  forks: ProtocolVersion.ForkSchedule,
): Either.Either<
  VersionedProvingServiceEffect<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>,
  ProvingConfigurationError
> => makeDefaultProvingServices(configuration, forks).pipe(Either.map(makeVersionedProvingServiceEffect));

/** The promise-facing surface of {@link makeDefaultVersionedProvingServiceEffect}, for the facade to expose. */
export const makeDefaultVersionedProvingService = (
  configuration: DefaultProvingConfiguration,
  forks: ProtocolVersion.ForkSchedule,
): Either.Either<
  VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>,
  ProvingConfigurationError
> => makeDefaultVersionedProvingServiceEffect(configuration, forks).pipe(Either.map(wrapVersionedEffectService));
