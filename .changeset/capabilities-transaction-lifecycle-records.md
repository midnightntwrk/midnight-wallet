---
'@midnightntwrk/wallet-sdk-capabilities': major
---

feat(capabilities)!: keep one lifecycle record per transaction, from balancing to its final state

The pending transactions store now holds one record per transaction instead of pending items and reservations side by
side (ADR 0011). A record moves `Balanced` → `Finalized` → `Submitted` and ends `Confirmed`, `Rejected`, `Orphaned`,
`Expired` or `Reverted`; it stays after it ends until its TTL passes, then is dropped. A reported inclusion overrules an
end the wallet only inferred, such as an expiry.

New exports: `Lifecycle` (the records and their pure moves), `TransactionLifecycleService`,
`TransactionLifecycleServiceImpl`, `TransactionLifecycleServiceEffect(Impl)`, `InclusionVerdict`, `WallClock` and
`LifecycleFormat` (the store's format versions and its `v1` → `v2` upgrade). The service polls the indexer for a
submitted transaction's verdict, sweeps expired and finished records each tick, and reads the time from an optional
`clock`.

The store format moves to `v2`. This release reads a `v1` store and upgrades it, but earlier releases refuse `v2`:
downgrading after this release has written the store loses the pending records.

BREAKING CHANGE — the pending-transactions service and its module are renamed for what they hold now, with no
deprecated aliases. `TransactionTrait` now requires `intentHashes`, `inputs` and `ttl`, so a custom trait must add them.

| Before                                                  | After                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| subpath `./pendingTransactions`                         | `./transactionLifecycle`                                    |
| `PendingTransactionsService` and its three implementations | `TransactionLifecycleService`, `TransactionLifecycleServiceImpl`, `TransactionLifecycleServiceEffect(Impl)` |
| `DefaultPendingTransactionsServiceConfiguration`        | `DefaultTransactionLifecycleServiceConfiguration`           |
| `PendingTransactions.TransactionTrait`, `VersionedTransactionTrait`, `traitForVersion`, `traitForTx`, `headTrait`, `singleTrait`, `recognisingTrait`, `TransactionResult` and its arms | the same names under `TransactionTraits` |
| `PendingTransactions.Reservation['inputs']`             | `TransactionTraits.Inputs` (also `Lifecycle.Inputs`)        |
| `PendingTransactions.PendingTransactions`, `empty`, `addReservation`, `clearReservation`, `expireReservations`, `allExpiredReservations`, `addPendingTransaction`, `clear`, `saveResult`, `orphanBeyond`, `coveredUnshieldedIds`, `has`, `all`, `allFailed`, `allOrphaned`, `allRejected`, `allPending`, `serialize`, `deserialize` | removed; use `Lifecycle` (`balanced`, `finalized`, `submitted`, `confirmed`, `rejected`, `orphanBeyond`, `reverted`, `expire`, `dropFinished`, `coveredUnshieldedIds`, `serialize`, `deserialize`) |
