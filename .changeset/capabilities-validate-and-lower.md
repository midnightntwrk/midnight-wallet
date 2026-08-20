---
'@midnightntwrk/wallet-sdk-capabilities': major
---

Validate a transaction at the version it was authored for, on a chain with a protocol boundary.

BREAKING CHANGE — `defaultLedgerParametersCodecs` is now a function of the chain's fork version and returns a registry
**split at it**: a block reported from before the boundary is read with the previous ledger version's deserializer and
one from the boundary with the current one, so the parameters handed to a validator are always ones its own
`LedgerState` accepts. `makeDefaultBlockDataFetcher`'s configuration gains a required `forkVersion` for the same
reason.

`makeDefaultValidationServices` and `makeDefaultVersionedValidationService` register a validator either side of the
boundary — the shipped pre-fork validator is no longer merely constructible but actually reachable — and route on the
version a transaction was authored for.

BREAKING CHANGE — `makeDefaultValidationService` and `makeDefaultValidationServiceEffect` take their block data as
`AnyLedgerParameters`, the union naming what a fetcher spanning a boundary can yield. The two ledger versions'
`LedgerParameters` are structurally identical, so this is a statement of intent rather than something the compiler
enforces; the distinction is nominal at run time, which is why the routing has to be right rather than merely
well-typed.

New: `@midnightntwrk/wallet-sdk-capabilities/signatures` lowers a signature or verifying key from the current ledger
version's `{ tag, value }` shape to the bare hex the previous one reads, and lifts it back. Lowering is partial — a
scheme that version does not have cannot be expressed there at all, and says so with `UnsupportedSignatureKindError` —
while lifting is total, because that version has exactly one scheme.
