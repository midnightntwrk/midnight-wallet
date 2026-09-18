// This file is part of midnight-ledger.
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

//! WASM bindings for the v8-to-v9 ledger state translation.
//!
//! One export, [`translate_ledger_state`]: a serialized `ledger-v8` `LedgerState` in, a serialized `ledger-v9`
//! `LedgerState` out.
//!
//! Serialized state is the whole interface, deliberately. This crate links both ledgers at once — that is the reason it
//! exists — but a caller cannot: neither ledger's state objects exist in the other's WASM module, so nothing but bytes
//! can cross. The encoding on both sides is [`serialize::tagged_serialize`], which is exactly what each ledger's own
//! WASM `LedgerState.serialize()` emits, so no framing step is needed at either end.
//!
//! The translation is cost-metered and runs in steps. Driving it to completion is this crate's business, not the
//! caller's — the budget and the loop stay inside.

use base_crypto::cost_model::CostDuration;
use js_sys::Uint8Array;
use v8_to_v9_state_translation::StateTranslationTable;
use std::ops::Deref;
use storage::arena::Sp;
use storage::db::InMemoryDB;
use storage::state_translation::TypedTranslationState;
use wasm_bindgen::prelude::*;

type V8LedgerState = ledger_v8::structure::LedgerState<InMemoryDB>;
type V9LedgerState = ledger_v9::structure::LedgerState<InMemoryDB>;

/// Cost budget granted to each translation step.
///
/// One second, which completes the translation crate's own test states in a single step. Larger states take more steps
/// rather than a larger budget, so this is a granularity knob and not a limit on what can be translated.
const STEP_BUDGET_PICOSECONDS: u64 = 1_000_000_000_000;

/// Steps to attempt before concluding the translation is not converging.
///
/// A translation that has not finished in this many steps is stuck rather than slow: each step either makes progress or
/// the state machine is not advancing, and an unbounded loop inside WASM would hang the caller with no way to tell why.
const MAX_STEPS: usize = 10_000;

/// Translate a serialized ledger-v8 `LedgerState` into a serialized ledger-v9 one.
///
/// # Errors
///
/// Fails if the input is not a `tagged_serialize`d ledger-v8 `LedgerState`, if the translation itself fails, if it does
/// not converge within [`MAX_STEPS`], or if the resulting v9 state cannot be serialized.
#[wasm_bindgen]
pub fn translate_ledger_state(v8_bytes: &[u8]) -> Result<Uint8Array, JsError> {
    let v8: V8LedgerState = serialize::tagged_deserialize(&mut &v8_bytes[..])
        .map_err(|e| JsError::new(&format!("not a serialized ledger-v8 LedgerState: {e}")))?;

    let budget = CostDuration::from_picoseconds(STEP_BUDGET_PICOSECONDS);

    let mut translation = TypedTranslationState::<
        V8LedgerState,
        V9LedgerState,
        StateTranslationTable,
        InMemoryDB,
    >::start(Sp::new(v8))
    .map_err(|e| JsError::new(&format!("failed to start the v8-to-v9 translation: {e}")))?;

    for _ in 0..MAX_STEPS {
        translation = translation
            .run(budget)
            .map_err(|e| JsError::new(&format!("the v8-to-v9 translation failed: {e}")))?;

        let result = translation
            .result()
            .map_err(|e| JsError::new(&format!("failed to read the translation result: {e}")))?;

        if let Some(v9) = result {
            // Serialized here, while `translation` is still alive: the translated state's nodes live in the arena the
            // translation owns, so serializing after dropping it loses the very children being written out.
            let mut serialized = Vec::new();
            serialize::tagged_serialize(v9.deref(), &mut serialized).map_err(|e| {
                JsError::new(&format!("failed to serialize the translated ledger-v9 state: {e}"))
            })?;
            return Ok(Uint8Array::from(&serialized[..]));
        }
    }

    Err(JsError::new(&format!(
        "the v8-to-v9 translation did not complete within {MAX_STEPS} steps"
    )))
}

/// Route Rust panics to `console.error` with their message and location.
///
/// Without this a panic anywhere inside the translation reaches JavaScript as a bare `RuntimeError: unreachable`,
/// because the `wasm` profile aborts on panic. For a one-shot migration tool run against real chain state, an opaque
/// trap is the difference between a diagnosable failure and an unactionable one.
#[wasm_bindgen(start)]
fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

