---
'@midnightntwrk/wallet-sdk-abstractions': major
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

`InMemoryTransactionHistoryStorage.restore` now returns an
`Either<InMemoryTransactionHistoryStorage, TransactionHistoryRestoreError>` rather than throwing. A payload that cannot
be read — unreadable JSON, a shape matching no known format, or a version written by a newer SDK — comes back as a
`Left` naming the surface and the version the payload was read from, instead of being handed back as an empty store.
Callers must handle the `Left`.

`upgradeV1ToV2` now takes a `readonly unknown[]` rather than `unknown`: deciding whether a payload is a bare array is
`detectVersion`'s job, and accepting anything else here is what used to let a non-array become an empty store.
`detectVersion` is exported and returns a tagged union, and `upgradeToCurrentFormat` returns an `Either` carrying the
upgraded entries alongside the version they were read from.

`NoOpTransactionHistoryStorage.serialize` now writes `{ version: 'v2', entries: [] }` rather than the bare `[]`, which
would have announced the first format.
