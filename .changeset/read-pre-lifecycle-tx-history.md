---
'@midnightntwrk/wallet-sdk-abstractions': minor
---

Read transaction histories written before the lifecycle field existed, and write a versioned envelope.

A history saved by abstractions 2.1.0 or earlier is a bare JSON array whose entries carry no `lifecycle`. Restoring one
with 3.0.0 threw a `ParseError`, so an application that upgraded could not open the history its users already had. It
is now brought up to the current format before the entry schema runs: each entry gains a `finalized` lifecycle and, if
it had none, an empty `identifiers` list. Every other field, including a `lifecycle` an entry already carries, is left
exactly as it was.

`finalized` is the only honest lifecycle for those entries. The only writer at the time ran from the sync path, after
the indexer had returned the transaction inside a block, so `status` is untouched — a `FAILURE` reached a block too, it
just failed once it ran.

Histories are now written as `{ version: 'v2', entries }`. `finalizedBlock` on a `finalized` lifecycle is optional,
because an upgraded entry records no block; readers that need one fetch it from the indexer by transaction hash.

A payload `InMemoryTransactionHistoryStorage.restore` cannot read — unreadable JSON, a shape matching no known format,
or a version written by a newer SDK — is now refused with a `TransactionHistoryRestoreError` instead of being handed
back as an empty store. The error names the surface and the version the payload was read from, carries a `reason` —
`unparseable`, `unrecognised`, `unknown-version` or `invalid-entries` — so an app can tell "written by a newer SDK"
from "corrupt" without reading the text, and its `message` says all of it, so a log line or `String(error)` is enough
to act on. `restore` throws it; the new `tryRestore` returns it as a `Left`, the same pairing every wallet's `restore`
and `tryRestore` have.

`upgradeV1ToV2` now takes a `readonly unknown[]` rather than `unknown`: deciding whether a payload is a bare array is
`detectVersion`'s job, and accepting anything else here is what used to let a non-array become an empty store.
`detectVersion` is exported and returns a tagged union, and `upgradeToCurrentFormat` returns an `Either` carrying the
upgraded entries alongside the version they were read from.

`NoOpTransactionHistoryStorage.serialize` now writes `{ version: 'v2', entries: [] }` rather than the bare `[]`, which
would have announced the first format.

The door is one-way. A history saved by this release cannot be opened by abstractions 2.1.0, and not only because of the
envelope: 2.1.0 also required `protocolVersion` and `status` on every entry, both optional now, so unwrapping the
envelope is not a downgrade path either. Downgrading an application after it has saved a history means losing that
history, and 2.1.0 fails loudly on it rather than opening an empty one.
