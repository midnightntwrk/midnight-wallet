---
'@midnightntwrk/wallet-sdk-prover-client': patch
---

fix(prover-client): prove ZKIR v3 circuits in process

The in-process prover (`WasmProver`, and the wasm proving services built on it) now proves contract circuits compiled
with compactc 0.36.0 or later, which emit ZKIR v3 only. Before, every such circuit failed with
`expected one of 'ir-source[v2-generic]' or 'ir-source[v2]', got 'ir-source[v3-generic]'`. Each proof now runs on the
runtime its circuit was compiled for, read from the circuit's serialization header: ZKIR v3 circuits on
`@midnightntwrk/zkir-v3`, everything else on `@midnightntwrk/zkir-v2` as before, so the wallet's own zswap and Dust
circuits, which are still ZKIR v2, prove unchanged. The package now depends on `@midnightntwrk/zkir-v3` `^3.2.0`, whose
runtime is loaded only when a ZKIR v3 circuit is proved. Key material is still looked up once per proof.
