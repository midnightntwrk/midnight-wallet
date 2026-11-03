---
'@midnightntwrk/wallet-sdk': major
---

feat(wallet-sdk)!: rename the pending-transactions entry point to transaction lifecycle

BREAKING CHANGE — `@midnightntwrk/wallet-sdk/capabilities/pendingTransactions` is now
`@midnightntwrk/wallet-sdk/capabilities/transactionLifecycle`, with no alias. The names re-exported from the root,
`/facade`, `/capabilities` and the `Capabilities` namespace change as listed in the `wallet-sdk-facade` and
`wallet-sdk-capabilities` changelogs.
