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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import type { V8UnboundTransaction } from '../proving/v8ProvingService.js';
import {
  makeValidationServiceEffect,
  type AnyLedgerParameters,
  type ValidationServiceDependencies,
  type ValidationServiceEffect,
  type WellFormedCheck,
  type WellFormedStrictnessFlags,
} from './validationService.js';

/**
 * Every ledger-v8 transaction shape well-formedness can be asked about — the ledger-v8 counterpart of
 * `AnyV9ValidatableTransaction`, and a genuinely different type from it: these are the other ledger version's classes,
 * and neither ledger can read the other's.
 */
export type AnyV8ValidatableTransaction =
  ledger.FinalizedTransaction | V8UnboundTransaction | ledger.UnprovenTransaction;

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

/**
 * The ledger-v8's well-formedness check.
 *
 * @remarks
 *   Structurally the same three steps as ledger-v9's, against a different ledger version's classes. It is the classes,
 *   not the steps, that make this a separate check: a ledger-v8 transaction cannot be handed to ledger-v9's
 *   `wellFormed`, nor ledger-v9 parameters to this one.
 */
export const v8WellFormedCheck: WellFormedCheck<AnyV8ValidatableTransaction, AnyLedgerParameters> = (
  tx,
  { networkId, ledgerParameters, flags, now },
) => {
  tx.wellFormed(buildBlankLedgerState(networkId, ledgerParameters), buildStrictness(flags), now);
};

/**
 * Builds the validator for ledger-v8 transactions.
 *
 * @remarks
 *   Registered below the fork version by `makeDefaultValidationServices`, against a block-data fetcher whose codec
 *   registry is split at the same version — so a block reported from before the boundary reaches this validator as
 *   ledger-v8 parameters, which is the only kind its ledger version can build a state from.
 * @param deps The network, clock, and the block-data fetcher, which decodes each block at the version it reports.
 * @returns A validator to register in a `ValidationServices` registry for the version range before the v9 fork.
 */
export const makeV8ValidationServiceEffect = (
  deps: ValidationServiceDependencies<AnyLedgerParameters>,
): ValidationServiceEffect<AnyV8ValidatableTransaction, AnyLedgerParameters> =>
  makeValidationServiceEffect(v8WellFormedCheck, deps);
