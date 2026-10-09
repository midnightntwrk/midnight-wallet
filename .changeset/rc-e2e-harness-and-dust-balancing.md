---
---

test: seal hand-built e2e transactions at the facade's version, and record the Dust fee-balancing loop

Test-only.

- Four undeployed suites failed 22 of 48 tests with "built for protocol version 0". The `sealed()` helper stamped
  hand-built transactions at `MinSupportedVersion` on a chain that is ledger-v9 from genesis; it now calls
  `facade.adoptTransaction`, so the stamp is whatever the facade is acting at. `swap` used a single-variant
  `CustomShieldedWallet`, which stamps everything at the minimum by design; it now uses `ShieldedWallet`.
- Both dust-wallet variants get a simulator-backed test of a Dust coin worth more than a transaction's fee but less
  than that fee plus its own spend, which must yield `InsufficientFundsError`. Balancing never settles today, so the
  tests are `it.fails`, stopped by a bounded coin-selection guard instead of hanging. Flip them to `it` in the fix.
