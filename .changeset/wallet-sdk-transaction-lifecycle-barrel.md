---
'@midnightntwrk/wallet-sdk': major
---

feat(wallet-sdk)!: rename the pending-transactions barrel to transaction lifecycle

BREAKING CHANGE — the `@midnightntwrk/wallet-sdk/capabilities/pendingTransactions` subpath is now
`@midnightntwrk/wallet-sdk/capabilities/transactionLifecycle`, re-exporting `@midnightntwrk/wallet-sdk-capabilities/transactionLifecycle`.
The old subpath is not kept as an alias. The names it exports change as listed in the `wallet-sdk-capabilities` and
`wallet-sdk-facade` changelogs.
