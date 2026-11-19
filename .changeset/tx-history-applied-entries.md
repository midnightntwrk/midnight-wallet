---
'@midnightntwrk/wallet-sdk-abstractions': minor
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
---

feat: store each shielded and Dust tx-history entry before the wallet state moves past it

`TransactionHistoryWriter.gotApplied` records a transaction a wallet has applied before it knows the block it landed
in: the entry is stored as `finalized` with no `finalizedBlock`, and a later `gotFinalized` fills the block in. On an
entry already under the hash it never erases a finalized lifecycle, `status`, `timestamp`, `fees` or identifiers
another write recorded. `InMemoryTransactionHistoryStorage` implements it and `NoOpTransactionHistoryStorage` ignores
it. The method is optional: a custom storage without it keeps working, and gets only complete entries.

With a storage that implements it, the shielded and Dust wallets store every change they apply as such an entry before
the state that moves past the change is committed, so a snapshot is never ahead of its history. The entry carries
`shieldedDetailsPending: true` (or `dustDetailsPending: true`) until the indexer has answered for it, and `false` once
its details are filled in. Entries still pending when a wallet starts, for example after a restore from a snapshot taken
mid-lookup, are completed in the background.
