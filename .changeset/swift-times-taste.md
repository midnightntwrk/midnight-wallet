---
---

Split unit tests from integration tests via a `*.integration.test.ts` filename suffix. Unit tests stay `*.test.ts`.
Adds `test:unit` / `test:integration` scripts and turbo tasks (`yarn test` still runs the full suite), and reworks CI to
run unit tests as a fast gate and integration tests as a per-file matrix. Test-infrastructure only — no API changes.
