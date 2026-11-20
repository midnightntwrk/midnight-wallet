---
'@midnightntwrk/wallet-sdk-runtime': patch
---

fix(runtime): give a starting variant the runtime's own scope

`Variant.VariantContext` gains an optional `runtimeScope`, filled by the runtime for every variant it starts. It stays
open from the wallet's start until it stops, across every hand-over, while the variant's own scope closes as soon as the
runtime hands over to the next variant. A variant forks work into it that must finish even after a hand-over but must
not outlive the wallet, such as the shielded wallet's tx-history writes. Variants that ignore the field are unaffected.
