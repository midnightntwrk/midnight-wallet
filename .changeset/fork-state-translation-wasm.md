---
'@midnightntwrk/wallet-sdk-capabilities': patch
---

Add a wallet-side loader for the ledger's v8-to-v9 ledger state translation, so a simulated fork can carry the pre-fork
chain's own ledger state across the boundary instead of approximating it.

The translation itself is a Rust crate that links both ledgers at once — nothing on the JavaScript side can do that,
which is why `LedgerStateTranslator` is stated in serialized bytes. The new private
`@midnightntwrk/wallet-sdk-state-translation` package holds both halves of the wallet side: a `wasm-bindgen` crate that
wraps the ledger's translation crate and compiles it to WASM, and the thin adapter that exposes `translateLedgerState`
shaped for `translatorFromAsync`.

Nothing about this package's published surface changes. The translation is a testing and migration concern rather than a
wallet runtime one — no wallet code path translates ledger state — so the new package is a `devDependency` only, and
consumer bundles are unaffected. The fork tests that use the real
translation live in the integration tier, and `turbo` builds the WASM before them — so running integration tests in
`capabilities` needs a Rust toolchain, while `dist`, `typecheck`, `lint` and `test:unit` do not.
