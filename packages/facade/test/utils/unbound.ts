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
 * Turning an unproven transaction into the unbound one a dApp hands over: proved, and not yet bound.
 *
 * @remarks
 *   Only for transactions with nothing to prove — no intent, or intents carrying unshielded offers alone — so the prover
 *   is never asked for a proof and the result is a genuine unbound transaction rather than an unproven one labelled as
 *   such.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';

/** A prover that is never asked anything, for transactions with no zero-knowledge proof to make. */
const noProofs = {
  check: () => Promise.resolve([]),
  prove: () =>
    Promise.reject(new Error('A transaction with no shielded or contract part should have nothing to prove')),
  lookupKey: () => Promise.resolve(undefined),
};

/** A ledger-v8 transaction with nothing to prove, at the unbound stage. */
export const v8UnboundOf = (
  transaction: ledgerV8.UnprovenTransaction,
): Promise<ledgerV8.Transaction<ledgerV8.SignatureEnabled, ledgerV8.Proof, ledgerV8.PreBinding>> =>
  transaction.prove(noProofs, ledgerV8.LedgerParameters.initialParameters().transactionCostModel.runtimeCostModel);

/** A ledger-v9 transaction with nothing to prove, at the unbound stage. */
export const v9UnboundOf = (
  transaction: ledgerV9.UnprovenTransaction,
): Promise<ledgerV9.Transaction<ledgerV9.SignatureEnabled, ledgerV9.Proof, ledgerV9.PreBinding>> =>
  transaction.prove(noProofs, ledgerV9.LedgerParameters.initialParameters().transactionCostModel.runtimeCostModel);
