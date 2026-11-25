---
'@midnightntwrk/wallet-sdk-runtime': minor
---

feat(runtime): let a variant run work beyond its own lifetime, with a grace period when the wallet stops

`Variant.VariantContext` gains an optional `runBeyondVariant`, filled by the runtime for every variant it starts. Work
run through it survives a hand-over and runs until the wallet stops. Stopping the wallet first stops the running
variant, so no more of that work starts, then gives the work still running up to `Variant.BACKGROUND_WORK_GRACE` (one
second) to finish, once for the whole wallet, and only then interrupts the rest. The shielded wallet runs its
tx-history writes through it. Variants that ignore the field are unaffected.
