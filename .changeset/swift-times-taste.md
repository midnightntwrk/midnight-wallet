---
---

Split unit tests from integration tests via a `*.integration.test.ts` filename suffix (unit tests stay `*.test.ts`),
add `test:unit` / `test:integration` scripts and turbo tasks (`yarn test` still runs everything), and run integration as
a per-file CI matrix.

Also reclassifies true end-to-end tests out of the integration suite: some facade tests and a couple of wallet tests
that drive full flows against real infra move into the `e2e-tests` package, and the docs-snippets runner now runs in the
e2e lane (while staying in its own package). This keeps the integration matrix lean. Test-infrastructure only — no API
changes.
