---
'@midnightntwrk/wallet-sdk-testkit': minor
---

Additions since 0.2

- `DUST_SYNC` selects the Dust sync model for a whole run, `events` or `projections`, and an unrecognized value is
  rejected rather than defaulted. Unset, it means `events` for the wallets `provideWallet` and `initWalletWithSeed`
  build and `projections` for the Dust and token-transfer scenarios; an explicit `dustWallet` option pins a model
  whatever the environment. Exports for it include `eventLessDustWallet`, `eventBasedDustWallet`, `DustWalletFactory`,
  `dustWalletFor`, `dustWalletFromEnv`, `dustSyncModelFromEnv`, `parseDustSyncModel`, `projectionsDustSyncOptions`,
  `manualProjectionsDustSyncOptions` and `snapshotPath`.
- `provideWallet` returns `restored`, saying whether the wallet came from the snapshot, and stops a restored facade that
  fails its sync check, or does not catch up within ten minutes, before it falls back or rejects.
- `createWalletLifecycle` saves and stops together the wallets a `beforeEach` adopts, reports every failure, and stops a
  wallet that finishes starting after its test was torn down.
- `parseMidnightNetwork` rejects an unrecognized `NETWORK` by name, and `stagenet` is a preset network.
- `waitForStableState` resolves once a predicate has held for a settling window, with the newest value that satisfies
  it.
