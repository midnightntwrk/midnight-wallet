---
---

Tests only: run the ledger-v9 in-process prover tests in the integration tier: they fetch key material over the network,
and their proofs no longer compete with every package's unit tests for CPU. Also give the spec-reference parity tests
a 120 s timeout, since under that same contention the Schnorr parity case ran past 30 s.
