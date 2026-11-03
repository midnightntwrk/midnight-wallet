---
'@midnightntwrk/wallet-sdk-capabilities': major
---

feat(capabilities)!: track each transaction as one lifecycle record

The pending-transactions service is replaced by `TransactionLifecycleService`, which keeps one record per transaction
from balancing to its final state: `Balanced` → `Finalized` → `Submitted`, ending `Confirmed`, `Rejected`, `Orphaned`,
`Expired` or `Reverted` (ADR 0011). An ended record stays until its TTL passes. `serializeState()` saves the store, and
`TransactionLifecycleServiceImpl.restore` reads it back.

The stored format moves from `v1` to `v2`. A `v1` store is read and upgraded; earlier releases refuse `v2`.

BREAKING CHANGE — renamed and reshaped, with no deprecated aliases:

| Before | After |
| --- | --- |
| subpath `./pendingTransactions` | `./transactionLifecycle` |
| `PendingTransactionsService` and its implementations | `TransactionLifecycleService`, `TransactionLifecycleServiceImpl`, `TransactionLifecycleServiceEffect(Impl)` |
| `InitParams`, `DefaultPendingTransactionsServiceConfiguration` | `TransactionLifecycleServiceInitParams`, `DefaultTransactionLifecycleServiceConfiguration` |
| `addPendingTransaction`, `clear`, `addReservation`, `clearReservation` | `balanced`, `finalized`, `submitted`, `reverted`, `included` |
| a custom service | must also implement `serializeState()` |
| `PendingTransactions.TransactionTrait` and the other trait helpers | the same names under `TransactionTraits` |
| `TransactionTrait.hasTTLExpired`, `isOneIncludedInOther` | removed; a trait now provides `intentHashes`, `inputs` and `ttl` |
| `PendingTransactions` state functions, reservations and items | `Lifecycle` (`LifecycleRecord`, `LifecycleState` and the moves between them) |
| `PendingTransactions.serialize`, `deserialize` | `Lifecycle.serialize`, `Lifecycle.deserialize`; format versions in `LifecycleFormat` |

Migrating: rename imports and names as the table says. A custom service adds `serializeState()`; a custom
`TransactionTrait` adds `intentHashes`, `inputs` and `ttl`. Applications that use the facade follow the step-by-step
guide in the `@midnightntwrk/wallet-sdk-facade` changelog for this release.
