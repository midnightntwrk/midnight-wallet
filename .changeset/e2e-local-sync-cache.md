---
---

test(e2e): give the snapshot-restore tests a directory of their own, and stop the e2e snapshot helpers reading
`SYNC_CACHE` themselves. The undeployed projections restore test needs a snapshot only within itself, but it reached
`SYNC_CACHE` — a cache of wallet state kept between runs, which the nightly local lane never sets — through
`saveState`, whose `exit(1)` then killed the vitest worker mid-test: every nightly since the ledger-v9 merge failed on a
crashed worker while the test report showed all tests passing. `provideWallet` and `saveState` now take the directory
as an argument. The two restore tests (projections, and the remote balance-constant healthcheck) pass a temporary
directory they remove afterwards; `nativeTokenTransfer.remote`, which does carry wallets between runs, passes
`SYNC_CACHE` through a helper that throws instead of exiting when it is unset.
