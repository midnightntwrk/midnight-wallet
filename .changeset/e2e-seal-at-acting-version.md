---
---

test(e2e): seal hand-built transactions at the version the facade is acting at

Test-only. Four undeployed suites — `optionalBalancing`, `facadeTransfer`, `swap`, `tokenTransfer` — failed 22 of 48
tests with `ProtocolVersionMismatchError: This transaction was built for protocol version 0`. The SDK was right to
refuse; the harness stamped wrongly, two ways:

- The `sealed()` helper stamped every hand-built transaction at `MinSupportedVersion`, on a local chain that is
  ledger-v9 from genesis and reports the fork version. It now calls `facade.adoptTransaction`, so the stamp is whatever
  the facade is acting at — right below the boundary, above it, and after a later fork, with no version literal to
  drift. This also gives `adoptTransaction` its first end-to-end use.
- `swap` composed a single-variant `CustomShieldedWallet`, which stamps everything at the minimum by design, so the
  facade refused its own shielded leg. It now uses the shipped `ShieldedWallet`.
