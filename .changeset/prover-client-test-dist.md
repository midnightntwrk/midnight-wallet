---
---

Build the prover-client package before running its own tests. The in-process prover spawns its worker from the package's
`dist/proof-worker.js`, so a test that reaches it needs the package built, not only its upstream dependencies. The `test`
task already declared that; `test:unit` and `test:integration`, added when the suite was split, did not, and on a fresh
CI runner `v8WasmProver.integration.test.ts` failed to find the worker and hung to its timeout. Tooling only — no API
changes.
