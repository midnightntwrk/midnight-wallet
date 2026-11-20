---
'@midnightntwrk/wallet-sdk-abstractions': minor
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-facade': minor
---

feat: store each shielded and Dust tx-history entry before the wallet state moves past it

**Storage.** New optional `TransactionHistoryWriter.gotApplied` stores a transaction the wallet has applied before its
block is known: `finalized`, no `finalizedBlock` (a later `gotFinalized` fills it in). It never erases a lifecycle,
`status`, `timestamp`, `fees` or identifiers already recorded under the hash. `InMemoryTransactionHistoryStorage`
implements it; `NoOpTransactionHistoryStorage` ignores it. A custom storage without it keeps working with complete
entries only, but then a snapshot can still be ahead of its history, and a lookup cut short by a stop still loses its
entry.

**Wallets.** With `gotApplied`, the shielded and Dust wallets store each applied change before committing the state
that moves past it, so a snapshot is never ahead of its history, provided the app serializes the wallet state before
the history (or both between updates).

- The entry carries `shieldedDetailsPending` / `dustDetailsPending: true` until the indexer answers, then `false`.
- Entries still pending at start (for example after a restore) are completed in the background.
- A failed `gotApplied` is logged and sync carries on; the full entry is written once the indexer answers.
- A stop does not wait for a storage write in progress: that update is abandoned and applied again on the next start.
- A lookup that fails in a way waiting cannot fix (4xx, 429, GraphQL error, invalid indexer URL) keeps the flag `true`
  and is looked up again on the next start.
- `TransactionHistoryService` gains optional `appliedEntries` (`record`, `pending`, `complete`), present exactly when
  the storage implements `gotApplied`.

**Facade.** Passes `gotApplied` through to the configured storage, and `WalletEntrySchema` declares both flags so they
survive serialize and restore. A flagged entry is `finalized` but may lack status, block or identifiers, so a missing
status does not mean success. It still counts as proof of inclusion when the transaction's verdict arrives: a partial
success releases the failed segments' bookings, a failure releases all of them, an orphaning releases nothing. An app
restoring its history with its own entry schema must declare both flags; otherwise they are kept but unread, and those
entries are never completed.
