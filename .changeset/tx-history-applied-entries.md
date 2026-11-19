---
'@midnightntwrk/wallet-sdk-abstractions': minor
---

feat(abstractions): add an optional `gotApplied` method to the transaction history writer

`TransactionHistoryWriter.gotApplied` records a transaction a wallet has applied before it knows the block it landed
in: the entry is stored as `finalized` with no `finalizedBlock`, and a later `gotFinalized` fills the block in. On an
entry already under the hash it never erases a finalized lifecycle, `status`, `timestamp`, `fees` or identifiers
another write recorded. `InMemoryTransactionHistoryStorage` implements it and `NoOpTransactionHistoryStorage` ignores
it. The method is optional: a custom storage without it keeps working, and gets only complete entries.
