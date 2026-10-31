---
'@midnightntwrk/wallet-sdk': major
---

refactor(wallet-sdk)!: re-export the narrower dust and capabilities roots

The umbrella package re-exports every wallet's root and the capabilities package, so it carries what those roots no
longer export.

BREAKING CHANGE:

- The dust V2 variant's sync module is no longer re-exported: `makeEventLessSyncService`, `makeEventLessSyncCapability`,
  `findDustTimelineStart` and the rest are `SyncService.*` from `@midnightntwrk/wallet-sdk-dust-wallet/v2`, and
  `DustTimelineStart` is `DustWalletTypes.DustTimelineStart`.
- `Capabilities.Simulator` and the rest of the unqualified ledger-v9 simulator are removed. Name it by its ledger
  version: `Capabilities.V9.Simulator`, as `Capabilities.V8.Simulator` already is.
