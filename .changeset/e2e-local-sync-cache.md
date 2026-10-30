---
'@midnightntwrk/wallet-sdk-testkit': minor
---

fix(testkit): save a wallet snapshot whole or not at all, report save failures, and never leave a test's wallet running

- `saveState` writes the shielded and dust states to one file per dust sync model (`snapshotPath`), under a temporary
  name renamed over the previous snapshot. The unshielded state, which a restore never read, is no longer saved. A save that fails or is killed part-way leaves the previous snapshot intact,
  so the next run can no longer restore one run's shielded state with another's dust. It now rejects when a state
  cannot be serialized or written, instead of logging and carrying on. Snapshots in the earlier per-wallet layout are
  ignored, so each carried cache builds from scratch once, and removed on the next save; `dustSnapshotPath` is
  deprecated.
- `provideWallet` returns `restored`, saying whether the wallet came from the snapshot: its fallback to a from-scratch
  build is silent, and balances alone cannot tell the two apart. A restored facade that fails its sync check, or does
  not catch up within ten minutes, is stopped before `provideWallet` falls back or rejects.
- New `createWalletLifecycle`: wallets a `beforeEach` adopts are saved and stopped together on release, every failure
  is reported, and a wallet that finishes starting after its test was torn down is stopped as it arrives. The dust and
  token-transfer scenarios use it.
- New `parseMidnightNetwork` rejects an unrecognized `NETWORK` by name, instead of failing later on endpoints there is
  no preset for.

The e2e suites drop their own copies of these helpers for the testkit's. The snapshot-restore tests save to a
temporary directory of their own rather than `SYNC_CACHE`, which the nightly local lane never sets and whose absence
crashed its vitest worker on every run since the ledger-v9 merge.
