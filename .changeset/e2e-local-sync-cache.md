---
---

test(e2e): stop the e2e snapshot helpers reading `SYNC_CACHE` themselves, and give the snapshot-restore tests a
directory of their own. The undeployed projections restore test needs a snapshot only within itself, but it reached
`SYNC_CACHE` — a cache of wallet state kept between runs, which the nightly local lane never sets — through
`saveState`, whose `exit(1)` then killed the vitest worker mid-test: every nightly since the ledger-v9 merge failed on a
crashed worker while the test report showed all tests passing.

`provideWallet` and `saveState` now take the directory as an argument. The two restore tests (projections, and the
remote balance-constant healthcheck) pass a temporary directory they remove afterwards, and stop the wallet they
restore. `nativeTokenTransfer.remote` treats `SYNC_CACHE` as optional, as the testkit-based remote suites already do,
and stops only the wallets its setup started. The e2e `saveState` now rejects when it cannot write a snapshot instead of
logging and carrying on, and removes the snapshot's files first so a partly written one is never restored; the
testkit's `saveState` is unchanged.
