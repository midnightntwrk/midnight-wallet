---
'@midnightntwrk/wallet-sdk': major
---

feat(wallet-sdk)!: rename the pending-transactions barrel to transaction lifecycle

BREAKING CHANGE — the `@midnightntwrk/wallet-sdk/capabilities/pendingTransactions` subpath is now
`@midnightntwrk/wallet-sdk/capabilities/transactionLifecycle`, re-exporting `@midnightntwrk/wallet-sdk-capabilities/transactionLifecycle`.
The old subpath is not kept as an alias.

The entry points that re-export the facade and capabilities change with them: the root `@midnightntwrk/wallet-sdk` and
`@midnightntwrk/wallet-sdk/facade` (for example `PendingStatus`, `PendingTransaction` and `pendingTransactionsOf` become
`LifecycleStatus`, `LifecycleEntry` and `lifecycleEntriesOf`), and `@midnightntwrk/wallet-sdk/capabilities` and the
root's `Capabilities` namespace (`PendingTransactions` becomes `Lifecycle`, `TransactionTraits` and `LifecycleFormat`).
Every renamed and removed name is listed in the `wallet-sdk-capabilities` and `wallet-sdk-facade` changelogs.
