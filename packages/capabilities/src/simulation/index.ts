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
 * Simulated ledger environments for wallet testing.
 *
 * There is one simulator per ledger version, in `v8/` and `v9/`. They are twins: the same simulator over a different
 * ledger, so a chain on either side of the hard fork is driven with the same API. Their shared, ledger-agnostic
 * internals live in `core/`.
 *
 * - **{@link V9}** — the ledger-v9 line. Used to drive a chain from the v9 fork, standalone or via {@link ForkSimulator}.
 * - **{@link V8}** — the ledger-v8 line. Used to drive a chain before the v9 fork, standalone or via {@link ForkSimulator}.
 * - **{@link ForkSimulator}** — the two composed into a single chain that crosses the fork.
 *
 * Neither twin is exported unqualified: they export identical names over structurally distinct ledger types, so a
 * simulator is always named by the ledger version it runs, `V9.Simulator` or `V8.Simulator`.
 */

/** The ledger-v9 simulator. */
export * as V9 from './v9/index.js';

/** The ledger-v8 simulator. */
export * as V8 from './v8/index.js';

// A chain that crosses the fork, built from both twins.
export { ForkSimulator, type ForkSimulatorConfig } from './ForkSimulator.js';

// Carrying ledger state across the fork.
export {
  LedgerTranslationError,
  translatorFromAsync,
  unavailableTranslator,
  type LedgerStateTranslator,
} from './LedgerTranslation.js';
