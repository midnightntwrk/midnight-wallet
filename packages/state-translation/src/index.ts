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
 * One function, {@link translateLedgerState}: serialized ledger-v8 state in, serialized ledger-v9 state out. Everything
 * that makes that possible — a WASM module linking both ledgers at once — is built from this package's own `wasm/`
 * crate, which wraps the ledger's translation crate.
 *
 * This exists for testing and migration work, not for the wallet's runtime: no wallet code path translates ledger
 * state. See the package README for how to build it.
 */

export { StateTranslationFailedError, translateLedgerState } from './StateTranslation.js';
