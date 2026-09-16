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
because an upgraded entry records no block; readers that need one fetch it from the indexer by transaction hash. A
payload that cannot be read — unreadable JSON, or a version written by a newer SDK — raises a
`TransactionHistoryRestoreError` naming the surface and the version found, instead of being handed back as an empty
store.
