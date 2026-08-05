// A stand-in for the WASM module: the snake_case export `wasm-bindgen` produces, translating by reversing the bytes.
export const translate_ledger_state = (preForkLedger) => new Uint8Array(Array.from(preForkLedger).reverse());
