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
 * Well-formedness for an SDK that spans a protocol boundary: one validator per ledger version, chosen by the version a
 * transaction was authored for.
 *
 * @remarks
 *   The two halves already exist and are each written against one ledger version. What this module supplies is the only
 *   thing neither of them can: the registration that says which range of protocol versions each one answers for, taken
 *   from the same fork version the wallets are built with.
 */
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either } from 'effect';
import {
  makePreForkValidationServiceEffect,
  type AnyPreForkValidatableTransaction,
} from './preForkValidationService.js';
import {
  makeDefaultValidationServiceEffect,
  makeVersionedValidationServiceEffect,
  wrapVersionedValidationService,
  type AnyLedgerParameters,
  type AnyValidatableTransaction,
  type ValidationServiceDependencies,
  type ValidationServiceEffect,
  type ValidationServices,
  type VersionedValidationService,
  type VersionedValidationServiceEffect,
} from './validationService.js';

/**
 * Every transaction shape either ledger version can be asked about.
 *
 * @remarks
 *   A genuine union, unlike {@link AnyLedgerParameters}: the two ledger versions' transaction types are nominally
 *   distinct, so a caller holding one of them is holding something the other version's validator provably cannot read.
 */
export type AnyVersionValidatableTransaction = AnyValidatableTransaction | AnyPreForkValidatableTransaction;

/** A validator registered in a two-version registry, whichever ledger version it was written against. */
export type VersionValidationServiceEffect = ValidationServiceEffect<
  AnyVersionValidatableTransaction,
  AnyLedgerParameters
>;

/**
 * Registers a validator either side of the protocol boundary.
 *
 * @remarks
 *   Both validators are handed the same block-data fetcher, and that is correct rather than a shortcut: the fetcher
 *   decodes a block's parameters with the codec registered for the version the block itself was reported under, so it
 *   already yields the ledger version whose validator will be chosen for a transaction authored in the same epoch. A
 *   transaction authored on the other side of the boundary from the chain's current block is the case neither can
 *   serve, and it fails at the ledger rather than silently checking against the wrong parameters.
 * @param deps The network, clock, and the block-data fetcher shared by both validators.
 * @param forkVersion The protocol version at which the chain hands over to the current ledger version.
 * @returns The validators and the version ranges they serve.
 */
export const makeDefaultValidationServices = (
  deps: ValidationServiceDependencies<AnyLedgerParameters>,
  forkVersion: ProtocolVersion.ProtocolVersion,
): ValidationServices<AnyVersionValidatableTransaction, AnyLedgerParameters> =>
  Either.getOrThrow(
    ProtocolVersion.makeRegistryFromActivations<VersionValidationServiceEffect>(
      forkVersion > ProtocolVersion.MinSupportedVersion
        ? [
            { sinceVersion: ProtocolVersion.MinSupportedVersion, value: makePreForkValidationServiceEffect(deps) },
            { sinceVersion: forkVersion, value: makeDefaultValidationServiceEffect(deps) },
          ]
        : // A chain whose boundary is at or below the minimum supported version has no pre-fork epoch to register for.
          [{ sinceVersion: ProtocolVersion.MinSupportedVersion, value: makeDefaultValidationServiceEffect(deps) }],
    ),
  );

/**
 * Builds the version-routed validator an SDK spanning a protocol boundary checks with.
 *
 * @param deps The network, clock, and the block-data fetcher shared by both validators.
 * @param forkVersion The protocol version at which the chain hands over to the current ledger version.
 * @returns A validator that routes on the version a transaction was authored for.
 */
export const makeDefaultVersionedValidationServiceEffect = (
  deps: ValidationServiceDependencies<AnyLedgerParameters>,
  forkVersion: ProtocolVersion.ProtocolVersion,
): VersionedValidationServiceEffect<AnyVersionValidatableTransaction, AnyLedgerParameters> =>
  makeVersionedValidationServiceEffect(makeDefaultValidationServices(deps, forkVersion));

/** The promise-facing surface of {@link makeDefaultVersionedValidationServiceEffect}, for the facade to expose. */
export const makeDefaultVersionedValidationService = (
  deps: ValidationServiceDependencies<AnyLedgerParameters>,
  forkVersion: ProtocolVersion.ProtocolVersion,
): VersionedValidationService<AnyVersionValidatableTransaction, AnyLedgerParameters> =>
  wrapVersionedValidationService(makeDefaultVersionedValidationServiceEffect(deps, forkVersion));
