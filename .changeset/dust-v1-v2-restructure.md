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

**The pre-fork variant syncs by event replay only, and permanently so.** The projections-based (eventless) fast sync
that `./v2` offers through `makeEventLessSyncService` / `makeEventLessSyncCapability` is built on four `DustLocalState`
members that exist only in ledger-v9:

- `updateGenerationTreeFromEvidence`
- `commitmentTreeFirstFree`
- `generatingTreeFirstFree`
- `nullifiers`

No published ledger-v8 has any of them (checked through 8.1.1, the latest), and no v8-compatible implementation exists
anywhere, so the path cannot be back-ported. `./v1` therefore synchronises by replaying the indexer's dust ledger
events — exactly what the shipped 1.x wallet does in production today — and does not export the projection schema types,
the `DustProjectionsUpdate` union, or the eventless sync service and capability. **This was decided on 2026-08-19 as a
permanent property of the pre-fork variant, not a temporary gap: no ledger change is being requested to close it.**
Anything written against `./v2`'s sync surface should expect to be adjusted, not merely repointed, if it also has to run
on `./v1`.

Aside from that exclusion, `./v1` does track this line rather than the released 1.x code: it carries the current dust
variant with the ledger swapped, including the lock that stops a second sync start from opening a duplicate
subscription, the one-shot `sync` entry point that lock makes safe, and `blockData` reporting an absent block through
the typed error channel instead of as a defect.

`@midnightntwrk/wallet-sdk` mirrors this: `dust/v1` now re-exports the ledger-v8 variant, and a new `dust/v2` subpath
re-exports the ledger-v9 one.

Nothing changes at the root entry points: `DustWallet`, `DustWalletAPI`, and friends keep their names, the production
wallet registered only the ledger-v9 variant at this point — it registers one either side of the boundary by the end of
this release — and serialized wallet states round-trip unchanged — snapshots never
embedded the variant naming. The testkit and facade updates are internal repoints to the renamed types.
