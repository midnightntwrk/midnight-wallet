---
---

ci: fix duplicated and mislabeled integration-test check names (#520)

Drops the redundant `Integration Tests:` prefix from the matrix job name (GitHub
already nests it under the `Integration Tests` caller job) and switches the JUnit
reporter to `annotate_only`, so it no longer spawns detached check-runs that were
mis-grouped under the unrelated "Check for Changeset" suite.
