---
'@midnightntwrk/wallet-sdk-prover-client': minor
---

Additions since 1.x

- `WasmProver.makeV8KeyMaterialProvider()` and `WasmProver.makeV9KeyMaterialProvider()` read each ledger version's key
  material from `https://srs.midnight.network/`, the host the ledger's own data provider reads. `KeyMaterialConfig`'s
  `source` reads the same files from a host of your own, such as a mirror or a browser page's own origin.
