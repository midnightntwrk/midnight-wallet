---
---

test(dust-wallet): record that Dust fee balancing spins instead of refusing when the covering coin cannot pay its own spend

Test-only. Both variants get a simulator-backed test of a single Dust coin worth more than a transaction's fee but less
than that fee plus the cost of spending it, which must yield `InsufficientFundsError`. Balancing never settles instead,
so the tests are marked `it.fails` and stop the loop with a bounded coin-selection guard rather than hang. Change them to
`it` in the fix.
