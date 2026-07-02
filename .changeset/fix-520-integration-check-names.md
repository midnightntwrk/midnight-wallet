---
---

ci: fix duplicated and mislabeled test check names (#520)

Drops the redundant `Integration Tests:` prefix from the matrix job name (GitHub
already nests it under the `Integration Tests` caller job) and switches both the
integration and unit JUnit reporters to `annotate_only`, so they no longer spawn
detached check-runs that were mis-grouped under the unrelated "Check for
Changeset" suite.
