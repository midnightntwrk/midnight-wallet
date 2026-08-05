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
 * The ledger-side v8-to-v9 ledger state translation, as seen from the wallet.
 *
 * One function, {@link translateLedgerState}: serialized pre-fork ledger state in, serialized post-fork ledger state
 * out. Everything that makes that possible — a WASM module linking both ledgers at once — lives on the other side of
 * the boundary, in the `midnight-ledger` repository.
 *
 * This exists for testing and migration work, not for the wallet's runtime: no wallet code path translates ledger
 * state. See the package README for how to point it at a local build.
 */

export {
  DefaultTranslationModule,
  StateTranslationFailedError,
  StateTranslationUnavailableError,
  TranslationModuleEnvVar,
  createLedgerStateTranslation,
  isLedgerStateTranslationAvailable,
  resolveTranslationModule,
  translateLedgerState,
  type LedgerStateTranslationOptions,
} from './StateTranslation.js';
