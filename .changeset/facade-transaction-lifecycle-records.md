---
'@midnightntwrk/wallet-sdk-facade': major
---

feat(facade)!: track every transaction as one lifecycle record, from balancing to its final state

The facade now records each transaction it balances, finalizes, submits or reverts in
`facade.transactionLifecycleService`, stamped by the facade's clock. A record ends confirmed or rejected from the
inclusions each wallet's sync writes, as well as from the indexer. When a finalized or submitted record ends rejected or
orphaned, the facade releases its coins; the release of restored bookings reads the records.

`FacadeState.lifecycle` lists every record, including ones that have ended, until their TTL passes. The new `isAwaiting`
tells the entries still waiting for an answer from the ended ones.

The service now holds each transaction as a `LifecycleTx` (the ledger transaction in whatever proof state its record
calls for, beside its protocol version) instead of a `FinalizedTx` handle. An application that stores the records and
hands them back must write and read them with `lifecycleTransactionTraits(configuration.forks.v9)`, not
`finalizedTransactionTraits`: `TransactionLifecycleServiceImpl.restore(stored, lifecycleTransactionTraits(forks.v9),
configuration)`, and `Lifecycle.serialize(state, lifecycleTransactionTraits(forks.v9))` to store. A store written by an
earlier release, in format `v1`, is read and upgraded; once this release has written it in `v2`, an earlier release
refuses it, so downgrading loses the pending records (each wallet's own bookings are untouched).

BREAKING CHANGE — the pending-transactions API changes shape:

| Before | After |
| --- | --- |
| `facade.pendingTransactionsService: PendingTransactionsService<FinalizedTx>` | `facade.transactionLifecycleService: TransactionLifecycleService<LifecycleTx>` |
| `InitParams.pendingTransactionsService`, returning a `PendingTransactionsService<FinalizedTx>` | `InitParams.transactionLifecycleService`, returning a `TransactionLifecycleService<LifecycleTx>` |
| a stored store restored with `finalizedTransactionTraits(forks.v9)` | restored with `lifecycleTransactionTraits(forks.v9)` |
| `FacadeState.pending` | `FacadeState.lifecycle` |
| `new FacadeState(shielded, unshielded, dust, pending, forkVersion)`, `pending` a `PendingTransactions.PendingTransactions<FinalizedTx>` | the fourth argument is a `Lifecycle.TransactionLifecycle<LifecycleTx>` |
| `PendingTransaction` | `LifecycleEntry` |
| `PendingStatus` | `LifecycleStatus` |
| `pendingTransactionsOf(pending)` | `lifecycleEntriesOf(lifecycle)`, over `Lifecycle.TransactionLifecycle` |
| `PendingTransaction.transaction: FinalizedTx` | `Option<FinalizedTx>`: none while only balanced |
| `PendingTransaction.submittedAt: DateTime.Utc`, the time it was finalized | `Option<DateTime.Utc>`: the time it was submitted, none until then and for a record read from a `v1` store |
| — | `LifecycleEntry.identifiers` |
| `PendingStatus` tags | adds `Balanced`, `Finalized`, `Expired` and `Reverted` |
| `Confirmed { segments }` | `Confirmed`, with no segments |
| `Rejected { segments }` | `Rejected { reason }`: `Refused { segments }` or `TTLPassed` |
| `!state.pending.length` to wait until settled | `!state.lifecycle.some(isAwaiting)`: ended entries stay listed |
