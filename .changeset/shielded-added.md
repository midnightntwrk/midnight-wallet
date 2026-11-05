---
'@midnightntwrk/wallet-sdk-shielded': minor
---

Additions since 3.x

- **Following the chain across the v9 fork.** Coins cross at their positions in the commitment tree. Their commitments
  and nullifiers are recomputed on the first synced update after the crossing, so until then `balances`,
  `availableCoins` and `pendingCoins` read empty. Coins booked for a ledger-v8 transaction still in flight are released
  in that same update, since nothing on ledger-v9 can include it. A wallet with no traffic of its own still notices the
  fork: its sync re-asks the chain's tip every 30 seconds (`versionWatch.intervalMs` of the variants'
  `Sync.DefaultSyncConfiguration`, not of `DefaultShieldedConfiguration`; zero or less disables it), and the recorded
  protocol version only increases.
- **Restoring.** A snapshot restores on the variant that wrote it (`writtenBy`), and snapshots written by 3.x still
  load. `ShieldedWallet(configuration).tryRestore(snapshot)` returns an `Either` instead of throwing, and the `Restore`
  namespace inspects a snapshot (`peekProtocolVersion`, `peekWriter`, `variantForSnapshot`,
  `UnsupportedSnapshotVersionError`). Snapshot fields this build does not declare are kept and written back.
- **Reserved coins.** `ShieldedWalletState.reservedCoins` lists the coins booked for a transaction that has not settled,
  each with `reservedSince` and `releasableAfter`; not to be confused with `pendingCoins`, the coins the wallet expects
  to receive. `balanceTransaction`, `transferTransaction` and `initSwap` take an optional trailing `ttl` that caps how
  long the coins they book stay booked.
- **Composition.** A `./v2` subpath (the ledger-v9 variant) beside `./v1`; both export `Migration` and `coreStateOf`,
  and their builders gain `withStartAux(Defaults)` and `withMigration(Defaults)`. `CustomForkingShieldedWallet` composes
  both variants from your own builders, and `ShieldedWalletTypes` holds the SDK-owned data and capability types.
