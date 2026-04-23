---
---

Expand UnshieldedState test coverage: lifecycle sequences (happy path, failure re-spendability, rollback re-spendability, reorg shape), behavioral edge cases (PARTIAL_SUCCESS, combined create+spend, pending cleanup, hash-keyed ordering), and fast-check invariants (collection disjointness, spend/rollback identity, spend/applyFailedUpdate identity). No production code changes.
