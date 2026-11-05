---
'@midnightntwrk/wallet-sdk-prover-client': major
---

Breaking changes since 1.x

- `HttpProverClient`, `proveTransaction` and `asProvingProvider()` work with `@midnightntwrk/ledger-v9` transactions.
  `ProverClient.Service` adds `asV8ProvingProvider()` and `asV9ProvingProvider()`, which implementers must provide.
- `WasmProver.makeDefaultKeyMaterialProvider()` serves ledger-v9's key material (circuit generation 10); 1.x served
  ledger-v8's. For ledger-v8, use `WasmProver.makeV8KeyMaterialProvider()` (generation 9).
- Depends on `@midnightntwrk/ledger-v9` `^1.0.0` beside `@midnightntwrk/ledger-v8`, on `@midnightntwrk/zkir-v2`
  `^2.2.0`, and on `@effect/platform` `^0.97`.
