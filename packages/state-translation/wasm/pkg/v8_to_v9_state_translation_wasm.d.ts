/**
 * WASM bindings for the ledger's v8-to-v9 ledger state translation.
 *
 * Serialized state is the whole interface: this module links both ledgers at once, but a caller cannot, since neither
 * ledger's state objects exist in the other's WASM module. The encoding on both sides is what each ledger's own
 * `LedgerState.serialize()` emits, so no framing step is needed at either end.
 */

/**
 * Translates a serialized ledger-v8 `LedgerState` into a serialized ledger-v9 one.
 *
 * The translation is cost-metered and runs in steps; this drives it to completion internally.
 *
 * @param v8_bytes - A ledger-v8 `LedgerState.serialize()`
 * @returns Bytes a ledger-v9 `LedgerState.deserialize` accepts
 * @throws If the input is not a serialized ledger-v8 `LedgerState`, if the translation fails, or if it does not
 *   converge.
 */
export function translate_ledger_state(v8_bytes: Uint8Array): Uint8Array;
