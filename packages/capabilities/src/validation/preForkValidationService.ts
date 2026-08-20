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
import {
  makeValidationServiceEffect,
  type ValidationServiceDependencies,
  type ValidationServiceEffect,
  type WellFormedCheck,
  type WellFormedStrictnessFlags,
} from './validationService.js';

/** A pre-fork transaction that has been proven but not yet bound. */
export type PreForkUnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

/**
 * Every pre-fork transaction shape well-formedness can be asked about — the pre-fork counterpart of
 * `AnyValidatableTransaction`, and a genuinely different type from it: these are the other ledger version's classes,
 * and neither ledger can read the other's.
 */
export type AnyPreForkValidatableTransaction =
  ledger.FinalizedTransaction | PreForkUnboundTransaction | ledger.UnprovenTransaction;

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
 * The pre-fork ledger version's well-formedness check.
 *
 * @remarks
 *   Structurally the same three steps as the current ledger's, against a different ledger version's classes. It is the
 *   classes, not the steps, that make this a separate check: a pre-fork transaction cannot be handed to the current
 *   ledger's `wellFormed`, nor current-ledger parameters to this one.
 */
export const preForkWellFormedCheck: WellFormedCheck<AnyPreForkValidatableTransaction, ledger.LedgerParameters> = (
  tx,
  { networkId, ledgerParameters, flags, now },
) => {
  tx.wellFormed(buildBlankLedgerState(networkId, ledgerParameters), buildStrictness(flags), now);
};

/**
 * Builds the validator for pre-fork transactions.
 *
 * @remarks
 *   Nothing in the SDK registers this yet, and that is a wiring gap rather than a missing capability. The default
 *   block-data fetcher decodes with `defaultLedgerParametersCodecs`, which is open-ended from the minimum supported
 *   version and holds only the current ledger's codec — so the block data reaching validation today is always
 *   current-ledger parameters, which this validator cannot use. Registering a pre-fork codec and routing the fetch on
 *   the block's reported version is what closes it; until then the pre-fork range stays empty and a pre-fork
 *   transaction is refused by name rather than checked against the wrong ledger.
 * @param deps The network, clock, and a block-data fetcher whose parameters are decoded at the pre-fork ledger version.
 * @returns A validator to register in a `ValidationServices` registry for the version range before the fork.
 */
export const makePreForkValidationServiceEffect = (
  deps: ValidationServiceDependencies<ledger.LedgerParameters>,
): ValidationServiceEffect<AnyPreForkValidatableTransaction, ledger.LedgerParameters> =>
  makeValidationServiceEffect(preForkWellFormedCheck, deps);
