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
 *   fork version the wallets are built with. Written the same way validation's `versionedValidation.ts` is, because it
 *   is the same problem.
 */
import * as preForkLedger from '@midnight-ntwrk/ledger-v8';
import * as ledger from '@midnightntwrk/ledger-v9';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, Either } from 'effect';
import {
  makePreForkServerProvingServiceEffect,
  makePreForkWasmProvingServiceEffect,
  type PreForkUnboundTransaction,
  type PreForkUnprovenTransaction,
} from './preForkProvingService.js';
import {
  makeServerProvingServiceEffect,
  makeVersionedProvingServiceEffect,
  makeWasmProvingServiceEffect,
  ProvingEpochMismatchError,
  resolveProvingBackends,
  wrapVersionedEffectService,
  type DefaultProvingConfiguration,
  type ProvingBackend,
  type ProvingConfigurationError,
  type ProvingServiceEffect,
  type ProvingServices,
  type UnboundTransaction,
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
export type AnyVersionUnprovenTransaction = ledger.UnprovenTransaction | PreForkUnprovenTransaction;

/** Every proved-but-unbound transaction either ledger version can hand back. */
export type AnyVersionUnboundTransaction = UnboundTransaction | PreForkUnboundTransaction;

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

const isPreForkTransaction = (transaction: AnyVersionUnprovenTransaction): transaction is PreForkUnprovenTransaction =>
  transaction instanceof preForkLedger.Transaction;

const isCurrentLedgerTransaction = (
  transaction: AnyVersionUnprovenTransaction,
): transaction is ledger.UnprovenTransaction => transaction instanceof ledger.Transaction;

/** The in-process backend's configuration, with a key material override only when one was named. */
const wasmConfigurationOf = (backend: Extract<ProvingBackend, { kind: 'wasm' }>): WasmProvingConfiguration =>
  backend.keyMaterialProvider === undefined ? {} : { keyMaterialProvider: backend.keyMaterialProvider };

/** Builds the backend a description names, on the ledger version the epoch it is registered for belongs to. */
const makeBackend = (
  backend: ProvingBackend,
  epoch: ProtocolVersion.ProtocolVersion.Range,
  forkVersion: ProtocolVersion.ProtocolVersion,
): VersionProvingServiceEffect =>
  epoch[1] <= forkVersion
    ? onlyFrom(
        backend.kind === 'server'
          ? makePreForkServerProvingServiceEffect({ provingServerUrl: backend.url })
          : makePreForkWasmProvingServiceEffect(wasmConfigurationOf(backend)),
        isPreForkTransaction,
        epoch,
      )
    : onlyFrom(
        backend.kind === 'server'
          ? makeServerProvingServiceEffect({ provingServerUrl: backend.url })
          : makeWasmProvingServiceEffect(wasmConfigurationOf(backend)),
        isCurrentLedgerTransaction,
        epoch,
      );

/**
 * Splits a registered range at the protocol boundary, so no single entry spans two ledger versions.
 *
 * @remarks
 *   A range that straddles the boundary is a description of _where_ to prove that says nothing about _which_ ledger
 *   frames the request — and both are needed. Splitting it keeps the operator's answer to the first question and lets
 *   the boundary answer the second, which is what makes "one proof server for every version" mean the right thing on
 *   both sides rather than the current ledger's thing on both.
 */
const splitAtFork = (
  entry: ProtocolVersion.RegistryEntry<ProvingBackend>,
  forkVersion: ProtocolVersion.ProtocolVersion,
): readonly ProtocolVersion.RegistryEntry<ProvingBackend>[] => {
  const [start, end] = entry.range;
  return start < forkVersion && forkVersion < end
    ? [
        { range: ProtocolVersion.makeRange(start, forkVersion), value: entry.value },
        { range: ProtocolVersion.makeRange(forkVersion, end), value: entry.value },
      ]
    : [entry];
};

/**
 * Registers a proving backend either side of the protocol boundary.
 *
 * @param configuration The proving configuration.
 * @param forkVersion The protocol version at which the chain hands over to the current ledger version.
 * @returns The backends and the version ranges they serve, or the reason the configuration names none.
 */
export const makeDefaultProvingServices = (
  configuration: DefaultProvingConfiguration,
  forkVersion: ProtocolVersion.ProtocolVersion,
): Either.Either<
  ProvingServices<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>,
  ProvingConfigurationError
> =>
  resolveProvingBackends(configuration).pipe(
    Either.map((backends) => ({
      // A chain whose boundary is at or below the minimum supported version has no pre-fork epoch to register for, so
      // nothing is split and every range is the current ledger's.
      entries: backends.entries
        .flatMap((entry) =>
          forkVersion > ProtocolVersion.MinSupportedVersion ? splitAtFork(entry, forkVersion) : [entry],
        )
        .map((entry) => ({ range: entry.range, value: makeBackend(entry.value, entry.range, forkVersion) })),
    })),
  );

/**
 * Builds the version-routed proving service an SDK spanning a protocol boundary proves with.
 *
 * @param configuration The proving configuration.
 * @param forkVersion The protocol version at which the chain hands over to the current ledger version.
 * @returns A proving service that routes on the version a transaction was built for, or the reason the configuration
 *   names no backend.
 */
export const makeDefaultVersionedProvingServiceEffect = (
  configuration: DefaultProvingConfiguration,
  forkVersion: ProtocolVersion.ProtocolVersion,
): Either.Either<
  VersionedProvingServiceEffect<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>,
  ProvingConfigurationError
> => makeDefaultProvingServices(configuration, forkVersion).pipe(Either.map(makeVersionedProvingServiceEffect));

/** The promise-facing surface of {@link makeDefaultVersionedProvingServiceEffect}, for the facade to expose. */
export const makeDefaultVersionedProvingService = (
  configuration: DefaultProvingConfiguration,
  forkVersion: ProtocolVersion.ProtocolVersion,
): Either.Either<
  VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>,
  ProvingConfigurationError
> => makeDefaultVersionedProvingServiceEffect(configuration, forkVersion).pipe(Either.map(wrapVersionedEffectService));
