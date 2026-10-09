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
 * Running the v8-to-v9 ledger state translation.
 *
 * The translation is Rust, compiled to WASM from this package's own `wasm/` crate, and it is the only thing that can
 * convert a ledger-v8 state into a ledger-v9 one: it links both ledgers at once, which nothing on the JavaScript side
 * can do. This module is the whole of the wallet side — hand it bytes, hand bytes back.
 *
 * Two deliberate shapes:
 *
 * - **Bytes in, bytes out.** Neither ledger's state objects exist in the other's WASM module, so serialized state is the
 *   only thing that crosses. Both ledgers' `LedgerState.serialize()` emits the tagged framing the translation consumes
 *   (`midnight:ledger-state[v13]` for v8, `[v18]` for v9), so no reframing is needed here.
 * - **A `Promise` that rejects, not an `Either`.** This package is a boundary onto a WASM module that signals failure by
 *   throwing, and its one consumer is `translatorFromAsync` in `@midnightntwrk/wallet-sdk-capabilities`, which wants
 *   exactly `(bytes) => Promise<Uint8Array>`. The `Effect`-shaped seam lives there; this side stays a thin adapter with
 *   no dependencies.
 *
 * The import is static, so the artifact has to exist: build it with `yarn build:wasm`, which `turbo` runs automatically
 * before any `test:integration`. There is deliberately no fallback — this package and the crate it wraps are the same
 * unit, so a missing artifact is a broken build rather than a state worth modelling.
 */

import { translate_ledger_state } from '../wasm/pkg/v8_to_v9_state_translation_wasm.js';

/**
 * The translation ran and did not produce a ledger-v9 state.
 *
 * Whether the bytes it did return are a _valid_ ledger-v9 state is not decided here — that belongs to whoever
 * deserializes them.
 */
export class StateTranslationFailedError extends Error {
  override readonly name = 'StateTranslationFailedError';

  constructor(cause: unknown) {
    super('The v8-to-v9 ledger state translation failed', { cause });
  }
}

/**
 * Translate a serialized ledger-v8 state into a serialized ledger-v9 one.
 *
 * Shaped for `translatorFromAsync` from `@midnightntwrk/wallet-sdk-capabilities`, which is how it reaches a
 * `ForkSimulator`.
 *
 * @example
 *   ```typescript
 *   const fork = yield* ForkSimulator.init({ ...config, translator: translatorFromAsync(translateLedgerState) });
 *   ```;
 *
 * @param v8State - A ledger-v8 `LedgerState.serialize()`
 * @returns Bytes a ledger-v9 `LedgerState.deserialize` accepts
 * @throws StateTranslationFailedError if the translation fails
 */
export const translateLedgerState = (v8State: Uint8Array): Promise<Uint8Array> => {
  try {
    // Not `async`: the WASM export is synchronous, so there is nothing to await. The result is still a `Promise`, and a
    // refusal still a rejection rather than a synchronous throw, because that is the contract `translatorFromAsync`
    // consumes — a caller writing `.catch(...)` must catch either way.
    return Promise.resolve(translate_ledger_state(v8State));
  } catch (cause) {
    // The WASM module's own error says why, so it has to survive as the cause: a refused translation arrives as a
    // `JsError` from Rust, and a panic as a bare `RuntimeError`.
    return Promise.reject(new StateTranslationFailedError(cause));
  }
};
