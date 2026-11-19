---
'@midnightntwrk/wallet-sdk-abstractions': minor
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-facade': minor
---

feat: store each shielded and Dust tx-history entry before the wallet state moves past it

`TransactionHistoryWriter.gotApplied` records a transaction a wallet has applied before it knows the block it landed
in: the entry is stored as `finalized` with no `finalizedBlock`, and a later `gotFinalized` fills the block in. On an
entry already under the hash it never erases a finalized lifecycle, `status`, `timestamp`, `fees` or identifiers
another write recorded. `InMemoryTransactionHistoryStorage` implements it and `NoOpTransactionHistoryStorage` ignores
it. The method is optional: a custom storage without it keeps working, but gets only complete entries, written once
the indexer has answered — so with such a storage a snapshot can still be saved ahead of its history, and an entry
whose lookup is cut short by the wallet stopping is still lost. Implement `gotApplied` to close both.

With a storage that implements it, the shielded and Dust wallets store every change they apply as such an entry before
the state that moves past the change is committed, so a snapshot is never ahead of its history — provided the
application serializes the wallet state before the history, or both at one point between updates; a history serialized
first can miss an update that lands before the state is. The entry carries `shieldedDetailsPending: true` (or
`dustDetailsPending: true`) until the indexer has answered for it, and `false` once its details are filled in. Entries
still pending when a wallet starts, for example after a restore from a snapshot taken mid-lookup, are completed in the
background. If the storage fails to record an applied entry, the failure is logged and sync carries on: the wallet
writes the complete entry once the indexer answers. An entry whose lookup fails in a way waiting cannot fix (a 4xx
response, 429 included, a GraphQL error, or an invalid indexer URL) is not tried again in that run; it keeps its flag
`true` and is looked up again the next time the wallet starts.

A custom `TransactionHistoryService` gains one optional member, `appliedEntries` (`record`, `pending`, `complete`); the
default service provides it exactly when the storage implements `gotApplied`.

The facade passes `gotApplied` through to the configured storage when it has it, and `WalletEntrySchema` declares both
flags, so a facade history keeps them through serialize and restore. An entry with either flag `true` is not finished:
it is `finalized` but may record no status, block or identifiers yet, so a missing status there does not mean success,
and the facade does not read it as the outcome of a transaction it is reconciling. An application that restores its
history with its own entry schema must declare the flag of each wallet it runs (`shieldedDetailsPending`,
`dustDetailsPending`); a schema without them keeps them through serialize and restore, but unread, so the restored
wallet never finds those entries pending, never completes them, and their stored flag stays `true`.
