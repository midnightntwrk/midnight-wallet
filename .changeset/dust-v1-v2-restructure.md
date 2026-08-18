---
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk': minor
'@midnightntwrk/wallet-sdk-testkit': patch
'@midnightntwrk/wallet-sdk-facade': patch
---

Restructure the dust wallet for the coming hard fork: the variant directories now say which ledger they run on.

**The `./v1` subpath's contents change on this beta line.** What `@midnightntwrk/wallet-sdk-dust-wallet/v1` exported in
`5.0.0-beta.2` — the ledger-v9 production variant — now lives at `./v2`, with every `V1`-named export renamed to `V2`
(`V1Builder`→`V2Builder`, `V1Tag`→`V2Tag`, `DefaultV1Configuration`→`DefaultV2Configuration`,
`RunningV1Variant`→`RunningV2Variant`, and so on). Imports of the old names from `./v1` will no longer resolve — switch
the subpath to `./v2`.

`./v1` now holds the restored pre-fork ledger-v8 variant with its honest `V1` names, kept for wallets that must sync
pre-fork history across the fork. This makes `@midnight-ntwrk/ledger-v8` a runtime dependency of the package: consumers
of the `./v1` subpath load a second ledger WASM module, which matters for browser bundle size. The `Simulator` namespace
exported from `./v1` is the ledger-v8 simulator twin only, where it previously re-exported the whole simulation entry
point.

Note that the two variants are not line-for-line equivalents of one another, and `./v1` is not simply `./v2` compiled
against the older ledger. Projections-based fast sync is built on ledger-v9 generation- and commitment-tree APIs that
have no ledger-v8 counterpart, so `./v1` syncs by event replay, as the pre-fork wallet always did, and does not export
the projection schema types. Anything written against `./v2`'s sync surface should expect to be adjusted, not merely
repointed, if it also has to run on `./v1`.

`@midnightntwrk/wallet-sdk` mirrors this: `dust/v1` now re-exports the ledger-v8 variant, and a new `dust/v2` subpath
re-exports the ledger-v9 one.

Nothing changes at the root entry points: `DustWallet`, `DustWalletAPI`, and friends keep their names, the production
wallet still registers only the ledger-v9 variant, and serialized wallet states round-trip unchanged — snapshots never
embedded the variant naming. The testkit and facade updates are internal repoints to the renamed types.
