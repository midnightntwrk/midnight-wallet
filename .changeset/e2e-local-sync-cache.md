---
---

ci(e2e): set `SYNC_CACHE` in the nightly local e2e workflow, and have the e2e snapshot helpers throw instead of
`exit(1)` when it is unset. The snapshot-restore projections test called `saveState` without it, which killed the
vitest worker mid-test: every nightly since the ledger-v9 merge failed on a crashed worker while the test report
showed all tests passing.
