---
'@midnightntwrk/wallet-sdk-dust-wallet': minor
---

Additions since 4.x

- **Projections fast sync.** The `./v2` `SyncService.makeEventLessSyncService` synchronizes Dust from the indexer's
  projections instead of replaying every Dust event. It runs in finite passes, repeated in the background every
  `backgroundSyncInterval` (default 5 s); every pass, idle or not, re-resolves the wallet's nullifiers. It needs
  ledger-v9 and does not hand over across a fork by itself: compose it as the V2 sync of a `CustomForkingDustWallet`
  whose V1 variant replays events. A restored projections wallet resumes from the block its last pass reached. A wallet
  that replays events refuses a projections snapshot at restore with `SnapshotSyncMismatchError`
  (`Wallet.SnapshotSyncMismatch`) rather than misread its position; a `SyncService` declares what it `resumesFrom`,
  which both shipped services do. `SyncService.DustProjectionsUpdate` names the update it applies, so the composed
  wallet's type is `ForkingDustWallet<WalletSyncUpdate, DustProjectionsUpdate>`, with the first from `./v1`.
- **Stepped sync.** `DustWallet.stepSync(keys)` runs one pass and returns; it completes only when the V2 variant uses a
  finite-pass sync such as the projections sync. Below `forks.v9`, where the V1 variant has no stepped sync, it rejects
  with `ManualSyncUnsupportedError` (`isManualSyncUnsupportedError`).
- **Skipping the ledger-v8 history.** A fresh wallet on a chain that crossed `forks.v9` replays the ledger-v8 Dust
  events before it crosses, only to start empty on ledger-v9. With `skipLedgerV8DustHistory` it starts at the last Dust
  event below the boundary instead, so they are never replayed. **The wallet's ledger-v8 Dust transaction history will
  be missing.** Off by default; a restored wallet resumes from its snapshot, and when the search cannot be made the
  start proceeds without it. The `./v2` `SyncService.findDustTimelineStart` is the search, and
  `ForkingDustConfiguration.dustTimelineStartProbe` opts a `CustomForkingDustWallet` in.
- **Fee coverage.** `InsufficientDustForFeeError` (`Wallet.InsufficientDustForFee`) reports that a first-time Dust
  registration cannot yet pay its own fee from the Dust its Night has generated: the `fee`, the `shortfall` and the
  `claimableFeePayment` in Specks, and an `estimate` of when generation will cover it (`Reachable`, with the seconds and
  the moment, or `Unreachable`, with the reason). One class serves both variants, so `instanceof` recognises it;
  `isInsufficientDustForFeeError` is the guard. `ensureFeeCoverage(currentTime, nightUtxos, feePayment, fee)` rejects
  with it, the coins-and-balances capability's `feeCoverageEstimate` computes the estimate, and
  `claimableFeePayment(dustState, nightUtxos, now)` gives the amount `waitForGeneratedDust` waits for.
- **Restoring.** A snapshot restores on the variant that wrote it. `DustWallet(configuration).tryRestore` returns an
  `Either` instead of throwing, `peekProtocolVersion` reads a snapshot's protocol version, and a snapshot in a format
  version this build does not know is refused with `SnapshotRestoreError` (`unknown-version`). Snapshot fields this
  build does not declare are kept and written back.
- **Composition.** A `./v2` subpath (the ledger-v9 variant) beside `./v1`; both export `Migration` and `coreStateOf`,
  and their builders gain `withStartAux(Defaults)` and `withMigration(Defaults)`. `CustomForkingDustWallet` composes
  both variants from your own builders, and `dustVariantConfigurations` gives each its own ledger version's parameters
  from plain rates (see also `asV8DustParameters` and `asV9DustParameters`). A wallet with no traffic of its own still
  notices the fork, re-asking the chain's tip every 30 seconds (`versionWatch.intervalMs` of the variants'
  `SyncService.DefaultSyncConfiguration`, not of `DefaultDustConfiguration`; zero or less disables it).
