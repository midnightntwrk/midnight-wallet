---
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk': minor
'@midnightntwrk/wallet-sdk-testkit': patch
'@midnightntwrk/wallet-sdk-facade': patch
---

Restructure the shielded wallet for the coming hard fork: the variant directories now say which ledger they run on.

**The `./v1` subpath's contents change on this beta line.** What `@midnightntwrk/wallet-sdk-shielded/v1` exported in
`4.0.0-beta.2` — the ledger-v9 production variant — now lives at `./v2`, with every `V1`-named export renamed to `V2`
(`V1Builder`→`V2Builder`, `V1Tag`→`V2Tag`, `DefaultV1Configuration`→`DefaultV2Configuration`,
`RunningV1Variant`→`RunningV2Variant`, and so on). Imports of the old names from `./v1` will no longer resolve — switch
the subpath to `./v2`.

`./v1` now holds the pre-fork ledger-v8 variant with its honest `V1` names, kept for wallets that must sync pre-fork
history across the fork: the `3.x` line's shielded internals restored, and then given this line's fork wiring, so both
variants carry the same boundary splitting, migration seam and healing emission (see the boundary-wiring change). This
makes `@midnight-ntwrk/ledger-v8` a runtime dependency of the package: consumers of the `./v1` subpath load a second
ledger WASM module, which matters for browser bundle size. The `Simulator` namespace exported from `./v1` is the
ledger-v8 simulator twin only, where it previously re-exported the whole simulation entry point.

`@midnightntwrk/wallet-sdk` mirrors this: `shielded/v1` now re-exports the ledger-v8 variant, and a new `shielded/v2`
subpath re-exports the ledger-v9 one.

Nothing changes at the root entry points: `ShieldedWallet`, `ShieldedWalletAPI`, and friends keep their names, the
production wallet still registers only the ledger-v9 variant, and serialized wallet states round-trip unchanged —
snapshots never embedded the variant naming. The testkit and facade updates are internal repoints to the renamed
types.
