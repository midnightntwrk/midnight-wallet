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
the state that moves past the change is committed, so a snapshot is never ahead of its history. The entry carries
`shieldedDetailsPending: true` (or `dustDetailsPending: true`) until the indexer has answered for it, and `false` once
its details are filled in. Entries still pending when a wallet starts, for example after a restore from a snapshot taken
mid-lookup, are completed in the background.

The facade passes `gotApplied` through to the configured storage when it has it, and `WalletEntrySchema` declares both
flags, so a facade history keeps them through serialize and restore. An entry with either flag `true` is not finished.
An application that restores its history with its own entry schema must declare the flag of each wallet it runs
(`shieldedDetailsPending`, `dustDetailsPending`); a schema without them drops them on the next serialize, and the
restored wallet then never completes those entries.
