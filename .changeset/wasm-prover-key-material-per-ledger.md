---
'@midnightntwrk/wallet-sdk-prover-client': major
'@midnightntwrk/wallet-sdk-capabilities': patch
---

fix(prover-client): prove each ledger version with its own key material, checked against the ledger release

The in-process prover's default key material was circuit generation 9, read from a development bucket, for both ledger
versions. `@midnightntwrk/ledger-v9` 1.0.0-rc.4 moved its Dust spend circuit to generation 10, so a node rejected every
Dust spend proved in-process for ledger-v9 with `Invalid Transaction: Custom error: 170` (`InvalidDustSpendProof`).
Proofs made by a proof server were not affected, and neither was ledger-v8.

- `WasmProver.makeV9KeyMaterialProvider()` reads ledger-v9's key material (generation 10) and
  `WasmProver.makeV8KeyMaterialProvider()` ledger-v8's (generation 9), both from `https://srs.midnight.network/`, the
  host the ledger's own data provider reads. `WasmProver.makeDefaultKeyMaterialProvider()` is ledger-v9's.
- Every file is checked against the SHA-256 its ledger release declares before it is used. A mismatch is refused with
  `KeyMaterialIntegrityError`; an error answer from the host with `KeyMaterialFetchError` (5xx and 429 are retried); an
  unreachable host with `KeyMaterialTransferError`; and a parameter size the ledger does not publish with
  `UnknownPublicParametersError`. An error answer used to be taken for key material.
- `{ source }` reads the same files from a host of your own — a mirror, or a browser page's own origin, since the
  default host sends no CORS headers — and checks them the same way.
- Capabilities: the in-process backend of each ledger version (`makeV8WasmProvingServiceEffect`,
  `makeV9WasmProvingServiceEffect`, and so the facade's `provers: { v8: { kind: 'wasm' } }` and
  `provers: { v9: { kind: 'wasm' } }`) proves with that ledger version's key material.

BREAKING CHANGE: `KeyMaterialConfig.circuits` is removed; name the ledger version instead of a circuit generation.
`makeDefaultKeyMaterialProvider({ circuits: 9 })` used for ledger-v8 becomes `makeV8KeyMaterialProvider()`; for ledger-v9
use `makeV9KeyMaterialProvider()`, since generation 9 is rejected for ledger-v9 Dust spends. Generation 8 never worked
with either ledger version. `KeyMaterialConfig` now holds `source`.
