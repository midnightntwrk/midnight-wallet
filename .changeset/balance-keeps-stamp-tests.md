---
---

Tests only: check that balancing a transaction in place keeps its stamp through the facade, from
`balanceUnboundTransaction` and `balanceUnprovenTransaction` to `finalizeRecipe`, on both sides of `forks.v9`, and
hand the unshielded wallet's unbound calls a real unbound transaction in its stamp tests.
