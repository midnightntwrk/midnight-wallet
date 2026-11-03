---
'@midnightntwrk/wallet-sdk-facade': major
---

feat(facade)!: track every transaction as one lifecycle record, from balancing to its final state

The facade now records each transaction it balances, finalizes, submits or reverts in
`facade.transactionLifecycleService`, stamped by the facade's clock. A record ends confirmed or rejected from the
inclusions each wallet's sync writes, as well as from the indexer. When a finalized or submitted record ends rejected or
orphaned, the facade releases its coins; the release of restored bookings reads the records.

`FacadeState.pending` lists every record, including ones that have ended, until their TTL passes. The new `isAwaiting`
tells the entries still waiting for an answer from the ended ones. `lifecycleTransactionTraits` and `LifecycleTx` are
exported for tests that restore a stored record.

BREAKING CHANGE — the pending-transactions API changes shape:

| Before                                           | After                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `facade.pendingTransactionsService`              | `facade.transactionLifecycleService`                                      |
| `InitParams.pendingTransactionsService`          | `InitParams.transactionLifecycleService`                                  |
| `pendingTransactionsOf(pending)`                 | `pendingTransactionsOf(lifecycle)`, over `Lifecycle.TransactionLifecycle` |
| `PendingTransaction.transaction: FinalizedTx`    | `Option<FinalizedTx>`: none while only balanced                           |
| `PendingTransaction.submittedAt: DateTime.Utc`   | `Option<DateTime.Utc>`: none until submitted                              |
| —                                                | `PendingTransaction.identifiers`                                          |
| `PendingStatus` tags                             | adds `Balanced`, `Finalized`, `Expired` and `Reverted`                    |
| `Confirmed { segments }`                         | `Confirmed`, with no segments                                             |
| `Rejected { segments }`                          | `Rejected { reason }`: `Refused { segments }` or `TTLPassed`              |
| `!state.pending.length` to wait until settled    | `!state.pending.some(isAwaiting)`: ended entries stay listed              |
