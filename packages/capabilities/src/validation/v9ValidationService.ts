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
import * as ledger from '@midnightntwrk/ledger-v9';
import { Either } from 'effect';
import type { V9UnboundTransaction, V9UnprovenTransaction } from '../proving/v9ProvingService.js';
import { runPromiseThrowingFailure } from './promiseBoundary.js';
import {
  LedgerParametersMismatchError,
  makeValidationServiceEffect,
  type AnyLedgerParameters,
  type LedgerParametersReader,
  type ValidationService,
  type ValidationServiceDependencies,
  type ValidationServiceEffect,
  type WellFormedCheck,
  type WellFormedStrictnessFlags,
} from './validationService.js';

/**
 * Every ledger-v9 transaction shape well-formedness can be asked about — the ledger-v9 counterpart of
 * `AnyV8ValidatableTransaction`, and a genuinely different type from it: these are the other ledger version's classes,
 * and neither ledger can read the other's.
 */
export type AnyV9ValidatableTransaction = ledger.FinalizedTransaction | V9UnboundTransaction | V9UnprovenTransaction;

const buildStrictness = (flags: WellFormedStrictnessFlags): ledger.WellFormedStrictness => {
  const strictness = new ledger.WellFormedStrictness();
  strictness.enforceBalancing = flags.enforceBalancing;
  strictness.verifySignatures = flags.verifySignatures;
  strictness.enforceLimits = flags.enforceLimits;
  return strictness;
};

const buildBlankLedgerState = (networkId: string, parameters: ledger.LedgerParameters): ledger.LedgerState => {
  const state = ledger.LedgerState.blank(networkId);
  state.parameters = parameters;
  return state;
};

/** The ledger-v9's well-formedness check. */
export const v9WellFormedCheck: WellFormedCheck<AnyV9ValidatableTransaction, ledger.LedgerParameters> = (
  tx,
  { networkId, ledgerParameters, flags, now },
) => {
  tx.wellFormed(buildBlankLedgerState(networkId, ledgerParameters), buildStrictness(flags), now);
};

const v9LedgerParameters: LedgerParametersReader<AnyLedgerParameters, ledger.LedgerParameters> = (parameters) =>
  parameters instanceof ledger.LedgerParameters
    ? Either.right(parameters)
    : Either.left(
        new LedgerParametersMismatchError({
          message:
            "ledger-v9's validator was handed another ledger version's parameters; it checks transactions only against ledger-v9's.",
        }),
      );

/**
 * Builds the validator for ledger-v9 transactions.
 *
 * @remarks
 *   Registered from the fork version by `makeDefaultValidationServices`, against a block-data fetcher whose codec
 *   registry is split at the same version — so a block reported from the boundary reaches this validator as ledger-v9
 *   parameters, which is the only kind its ledger version can build a state from.
 * @param deps The network, clock, and the block-data fetcher, which decodes each block at the version it reports.
 * @returns A validator to register in a `ValidationServices` registry for the version range from the v9 fork.
 */
export const makeV9ValidationServiceEffect = (
  deps: ValidationServiceDependencies<AnyLedgerParameters>,
): ValidationServiceEffect<AnyV9ValidatableTransaction, AnyLedgerParameters> =>
  makeValidationServiceEffect(v9WellFormedCheck, v9LedgerParameters, deps);

/**
 * The promise-facing surface of {@link makeV9ValidationServiceEffect}, rejecting with the typed failure itself.
 *
 * @param deps The network, clock, and the block-data fetcher, which decodes each block at the version it reports.
 * @returns A validator for ledger-v9 transactions.
 */
export const makeV9ValidationService = (
  deps: ValidationServiceDependencies<AnyLedgerParameters>,
): ValidationService<AnyV9ValidatableTransaction, AnyLedgerParameters> => {
  const effectService = makeV9ValidationServiceEffect(deps);
  return {
    validateTx: (tx, options) => runPromiseThrowingFailure(effectService.validateTx(tx, options)),
  };
};
