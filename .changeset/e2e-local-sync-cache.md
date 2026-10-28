---
---

test(e2e): give the snapshot-restore projections test a directory of its own, and stop the e2e snapshot helpers
reading `SYNC_CACHE` themselves. The test needs a snapshot only within itself, but it reached `SYNC_CACHE` — a cache of
wallet state kept between runs, which the nightly local lane never sets — through `saveState`, whose `exit(1)` then
killed the vitest worker mid-test: every nightly since the ledger-v9 merge failed on a crashed worker while the test
report showed all tests passing. `provideWallet` and `saveState` now take the directory as an argument; the remote
suites pass `SYNC_CACHE`, read by a helper that throws instead of exiting when it is unset.
