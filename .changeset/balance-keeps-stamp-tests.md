---
---

Tests only: check that balancing a transaction in place keeps its stamp through the facade, from
`balanceUnboundTransaction` and `balanceUnprovenTransaction` to `finalizeRecipe`, and hand the unshielded wallet's
unbound calls a real unbound transaction in its stamp tests.
