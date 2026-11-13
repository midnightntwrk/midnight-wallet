# @midnightntwrk/wallet-sdk-dust-wallet

## 5.1.0-rc.0

### Minor Changes

- aaad829: `dustWalletProbes(configuration)` is now exported: the probes `DustWallet` asks before a fresh start,
  including the search for where the dust timeline reaches `forks.v9` when `skipLedgerV8DustHistory` is set. A
  composition with its own variants spreads it into its configuration to start where `DustWallet` would.

  The testkit's `eventLessDustWallet` now takes its probes from `dustWalletProbes`, so it honours
  `skipLedgerV8DustHistory` as `DustWallet` does. The remote network presets set that flag, so a new wallet on a network
  that crossed the v9 fork starts its Dust at the boundary instead of replaying the ledger-v8 history: on qanet a cold
  sync drops from tens of minutes to seconds. The undeployed environment leaves it off, because a local chain has no
  ledger-v8 history to skip. The qanet preset's indexer subscription now uses the indexer host; the host it named does
  not serve it, so a wallet restored from a snapshot never connected.

### Patch Changes

- 408947a: fix(dust-wallet): keep the projections sync going when a pass finds Dust it already applied

  A Dust wallet on the projections sync no longer stops synchronizing when a pass hands back a coin it already applied.
  Such a coin is now left out of the update, with a warning from the pass that found it, and the collapsed updates a
  pass requests no longer reach back into applied indexes.

- 8bb4e6b: fix(dust-wallet): refuse a dust snapshot holding values the wallet cannot use

  A dust snapshot with an out-of-range or malformed value in a `pendingDust` entry used to restore, and then every sync
  threw while settling the entry and retried forever, with nothing able to remove it. Restore now refuses such a
  snapshot with `SnapshotRestoreError` (`invalid-shape`), on both variants.

  A pending entry's `nullifier`, `owner` and `nonce` must be field elements, `initialValue` a u128, `mtIndex` a u64,
  `seq` a whole u32, and `backingNight` 32 bytes of hex: the bounds the ledger reads them in. At the top level,
  `publicKey.publicKey` must be a field element; `offset` must fit the signed 32-bit integer the indexer takes as the
  position sync resumes from; and `protocolVersion` must lie from `MinSupportedVersion` up to, but not including,
  `MaxSupportedVersion`, the range some variant runs. `networkId` stays any string, so snapshots of custom networks
  still restore.

  This is a patch: every snapshot refused now is one the wallet could never have synced from, and every snapshot the
  wallet itself writes meets these bounds.

- 6bf13d8: chore: upgrade `@midnightntwrk/ledger-v9` to 1.0.2-rc.0 and `@midnightntwrk/zkir-v3` to 3.2.1, and run proof
  server 9.0.2-rc.1, the build that carries both; ledger-v9's key material is unchanged (circuit generation 10). Test
  stacks move to node 2.1.101 and indexer 4.4.101.
- Updated dependencies [5932cd8]
- Updated dependencies [6bf13d8]
- Updated dependencies [a81da4c]
  - @midnightntwrk/wallet-sdk-capabilities@4.0.1-rc.0
  - @midnightntwrk/wallet-sdk-address-format@4.0.1-rc.0
  - @midnightntwrk/wallet-sdk-utilities@1.3.1-rc.0
  - @midnightntwrk/wallet-sdk-indexer-client@2.0.1-rc.0
  - @midnightntwrk/wallet-sdk-runtime@2.0.1-rc.0

## 5.0.0

### Major Changes

- 9907a64: build: depend on the final ledger, zkir and proof server releases, all from `@midnightntwrk`

  - `@midnightntwrk/ledger-v9` `^1.0.0` (was `1.0.0-rc.7`). Its key material pins are those `midnight-ledger`
    `ledger-9.1.0.0` declares, the same circuits as `ledger-9.1.0.0-rc.7`.
  - `@midnightntwrk/ledger-v8` `^8.1.3` (was `@midnight-ntwrk/ledger-v8` `^8.1.0`), with the same key material as 8.1.0.
  - `@midnightntwrk/zkir-v2` `^2.2.0` (was `@midnight-ntwrk/zkir-v2` `2.2.0-rc.6`).
  - The testing helpers' proof server image is `9.0.0` (was `9.0.0-rc.10`).

  Every Midnight package the SDK depends on now installs from the public npmjs registry, without credentials.

  BREAKING CHANGE: ledger-v8 comes from `@midnightntwrk/ledger-v8`. An application that builds ledger-v8 objects and
  hands them to the wallet imports them from `@midnightntwrk/ledger-v8` as well; objects from
  `@midnight-ntwrk/ledger-v8` belong to a second copy of the ledger, which the wallet's own does not accept.

- 1e0ea94: Breaking changes since 4.x

  - **Two ledger versions.** `DustWallet(configuration)` runs a ledger-v8 variant (V1) below `forks.v9` and a ledger-v9
    variant (V2) from it. At the crossing the Dust state starts empty and is rebuilt from the chain. `forks` is
    required, and `DefaultDustConfiguration` is declared by the package.
  - **Starting.** `DustWallet(configuration).startWithSeed(seed, rates?)` returns a `Promise`, and `startWithSecretKey`
    is replaced by `startWithKeys({ v8, v9 }, rates?)`. Generation rates are plain `DustGenerationRates` rather than
    ledger `DustParameters`, though either ledger version's `DustParameters` is still accepted; left out, they are the
    configured `dustParameters`, which default to ledger-v9's initial ones. A fresh start asks the chain the protocol
    version of its first block (`chainVersionProbe`, by default the indexer) to pick the variant; if the probe fails, it
    starts on V1. An instance's `start` takes `DustKeysByEpoch`, `{ v8, v9 }`, whichever variant it resumes on, and
    keeps them until `stop()`.
  - **Transacting.** `estimateFee` and `balanceTransactions` no longer take a secret key; after `stop()` they fail with
    `MissingStartAuxError`. `balanceTransactions` resolves `{ transaction, blockData }`, where `blockData` holds the
    ledger parameters the fee was priced with (typed `unknown` on `DustWalletAPI`; read them with the capabilities
    `withLedgerParameters`). Transactions are `WalletTransaction` handles; a handle for the other ledger version is
    refused with `ProtocolVersionMismatchError`, except by `revertTransaction`, which ignores it. Signatures, and the
    `nightVerifyingKey` that `createDustGenerationTransaction` and `attachDustRegistration` take, use the SDK's
    `Signing` types, and an ECDSA one is refused below `forks.v9`.
  - **API types.** `DustWalletAPI<TKeys = never, TSerialized>`: `start(keys)` takes the wallet's own keys type, and the
    API requires `stepSync` and `ensureFeeCoverage`. `DustWalletState.state` is sealed: read it with `coreStateOf` from
    `./v1` or `./v2`. The state loses `capabilities`, `services` and `mapState` (use `fromVariant`), and its constructor
    takes `(protocolVersion, state, projections)` in place of `(state, capabilities, services)`.
    `DustWalletCapabilities` and `DustWalletServices` are removed, and the shared types live in `DustWalletTypes`.
  - **Subpaths.** `./v1` exports the ledger-v8 variant and no longer the wallet API: import `DustWallet`,
    `CustomDustWallet`, `DustWalletAPI`, `DustWalletState` and `DefaultDustConfiguration` from the package root. Its
    `Simulator` is the capabilities `V8` simulator.
  - **`CustomDustWallet`** composes one ledger-v9 variant, from a V2 builder with ledger-v9 `DustParameters`, instead of
    a ledger-v8 one; its starts stay synchronous, its instance `start` takes `{ v9: key }`, and it cannot cross a fork.
  - **Custom sync and core state.** A `SyncService` declares how background synchronization repeats its `updates`, as a
    required `backgroundRepeat`: `BackgroundRepeat.Once()` for a long-lived subscription, or
    `BackgroundRepeat.WithDelay({ delay })`. Sync updates are tagged `Events` or `VersionSignal`, `applyUpdate` receives
    the protocol-version range its variant owns, and `BlockData` requires `protocolVersion`. A custom variant
    (`V1Variant`, `V2Variant`) must supply `startAux`, the `StartMaterial.StartAuxCapability` its builder sets with
    `withStartAux(Defaults)`, and takes an optional fifth type parameter for the previous variant's state.
    `CoreWallet.pendingDust` holds `PendingDust` entries (`{ coin, nullifier, declaredTime }`), and `DustWithNullifier`
    is removed. `CoreWallet` records which sync moved its position as a required `syncKind`
    (`'events' | 'projections'`), which `CoreWallet.restore` takes as its last argument.
  - **Errors.** The `WalletError` union of `./v1` and `./v2` gains `SnapshotRestoreError`, `OutOfOrderSyncUpdateError`
    and `InsufficientDustForFeeError`, and that of `./v2` also `SnapshotSyncMismatchError`, so an exhaustive match over
    it must handle them.
  - **Snapshots.** Snapshots are format `v2`, recording the variant that wrote them, the Dust still pending, and which
    sync saved their position (`syncKind`); 4.x snapshots are read and upgraded. Once this release has saved a wallet,
    going back to 4.x means restoring it from its seed. An unreadable snapshot is refused with `SnapshotRestoreError`
    instead of `Wallet.Other`, and `restore` throws that tagged error.
  - **Transaction history.** `txHistoryStorage` is a `DustHistoryStorage`, and a `DustTransactionHistoryEntry` is the
    common lifecycle entry with an optional `dust` section. A custom `TransactionHistoryService` returns
    `TransactionDetails` with the `block` (`hash`, `height`, `timestamp`), the transaction's `identifiers` and its
    `fees` in place of `timestamp`, and may fail with `BlocklessFinalizedEntryError`.
  - **Dependencies.** Depends on `@midnightntwrk/ledger-v9` `^1.0.0` beside `@midnightntwrk/ledger-v8`.

### Minor Changes

- 1e0ea94: Additions since 4.x

  - **Projections fast sync.** The `./v2` `SyncService.makeEventLessSyncService` synchronizes Dust from the indexer's
    projections instead of replaying every Dust event. It runs in finite passes, repeated in the background every
    `backgroundSyncInterval` (default 5 s); every pass, idle or not, re-resolves the wallet's nullifiers. It needs
    ledger-v9 and does not hand over across a fork by itself: compose it as the V2 sync of a `CustomForkingDustWallet`
    whose V1 variant replays events. A restored projections wallet resumes from the block its last pass reached. A
    wallet that replays events refuses a projections snapshot at restore with `SnapshotSyncMismatchError`
    (`Wallet.SnapshotSyncMismatch`) rather than misread its position; a `SyncService` declares what it `resumesFrom`,
    which both shipped services do. `SyncService.DustProjectionsUpdate` names the update it applies, so the composed
    wallet's type is `ForkingDustWallet<WalletSyncUpdate, DustProjectionsUpdate>`, with the first from `./v1`.
  - **Stepped sync.** `DustWallet.stepSync(keys)` runs one pass and returns; it completes only when the V2 variant uses
    a finite-pass sync such as the projections sync. Below `forks.v9`, where the V1 variant has no stepped sync, it
    rejects with `ManualSyncUnsupportedError` (`isManualSyncUnsupportedError`).
  - **Skipping the ledger-v8 history.** A fresh wallet on a chain that crossed `forks.v9` replays the ledger-v8 Dust
    events before it crosses, only to start empty on ledger-v9. With `skipLedgerV8DustHistory` it starts at the last
    Dust event below the boundary instead, so they are never replayed. **The wallet's ledger-v8 Dust transaction history
    will be missing.** Off by default; a restored wallet resumes from its snapshot, and when the search cannot be made
    the start proceeds without it. The `./v2` `SyncService.findDustTimelineStart` is the search, and
    `ForkingDustConfiguration.dustTimelineStartProbe` opts a `CustomForkingDustWallet` in.
  - **Fee coverage.** `InsufficientDustForFeeError` (`Wallet.InsufficientDustForFee`) reports that a first-time Dust
    registration cannot yet pay its own fee from the Dust its Night has generated: the `fee`, the `shortfall` and the
    `claimableFeePayment` in Specks, and an `estimate` of when generation will cover it (`Reachable`, with the seconds
    and the moment, or `Unreachable`, with the reason). One class serves both variants, so `instanceof` recognises it;
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

### Patch Changes

- 1e0ea94: Fixes and other changes since 4.x

  - `computeBalancingRecipe` no longer loops forever on a wallet holding several part-drained Dust coins. Each pass now
    covers the fee still unpaid over the coins not yet selected, and a pass that selects no coin fails instead of
    repeating. With the loop bounded, Dust the transactions already carry counts toward the fee; a transaction that
    already covers its fee gets an empty balancing transaction, where 4.x looped forever; a coin selection that exhausts
    the pool is retried once largest-first; and a selector that returns a coin it was not offered fails with
    `TransactingError`. `dryRunFee` takes an optional trailing parameter carrying the proof-erased, merged transactions,
    and with no inputs prices the transactions as they are rather than with an extra empty intent.
  - Reverting a transaction releases only the Dust it booked. It used to drop decaying Dust coins the transaction never
    spent, and release coins other pending transactions held. A coin a pending transaction spent stays pending through
    syncs, and in the snapshot, until the chain spends it, its lock runs out or it decays to nothing
    (`CoreWallet.settlePendingDust`).
  - A reordered event batch is refused whole, and the sync retries from the same position, instead of applying it.
  - A transaction's Dust history section is no longer dropped when its event arrives before the indexer can serve the
    transaction's details: the lookup is retried for `transactionDetailsRetryWindow` (default 2 minutes), and a section
    still missing after that is logged with its transaction hash. History lookups run at most eight at a time.
  - The sync's retry back-off is really capped at two minutes, with jitter. A second `start()` no longer starts a second
    sync. A Dust wallet syncing from a `Simulator` reports the chain tip and `isConnected`. A block the indexer cannot
    return is a typed error rather than a defect.

- d898335: fix(dust-wallet): date a Dust spend only at a block whose roots the wallet holds

  Paying a fee with Dust no longer dates the spend at a block whose Dust events the wallet has not applied, which the
  node rejected with `Custom error: 170`. Without a `currentTime`, `balanceTransactions` dates the spend at the newest
  block when the wallet's Dust tree roots match that block's. A wallet on the event-less sync otherwise dates it at the
  block its last pass verified, when that block is no more than ten minutes behind the newest and its Dust grace period
  lasts until the transaction's TTL. When neither holds, balancing reads the newest block again every second, reserving
  nothing, and after two minutes fails with `SyncWalletError`, whose cause names the wallet's roots, the block's, and
  why the wallet's own block was refused. A `currentTime` the caller passes is used at once. When the newest block
  reports no roots at all, as the simulator's do, the spend is dated at it at once and a warning is logged. The V1
  variant's `BlockData` gains the optional `dustCommitmentMerkleTreeRoot` and `dustGenerationMerkleTreeRoot` the indexer
  reports. The facade's balancing and transfer methods document the possible wait.

- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [2e933df]
- Updated dependencies [9907a64]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0
  - @midnightntwrk/wallet-sdk-address-format@4.0.0
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0
  - @midnightntwrk/wallet-sdk-utilities@1.3.0
  - @midnightntwrk/wallet-sdk-indexer-client@2.0.0
  - @midnightntwrk/wallet-sdk-runtime@2.0.0

## 5.0.0-rc.3

### Patch Changes

- d898335: fix(dust-wallet): date a Dust spend only at a block whose roots the wallet holds

  Paying a fee with Dust no longer dates the spend at a block whose Dust events the wallet has not applied, which the
  node rejected with `Custom error: 170`. Without a `currentTime`, `balanceTransactions` dates the spend at the newest
  block when the wallet's Dust tree roots match that block's. A wallet on the event-less sync otherwise dates it at the
  block its last pass verified, when that block is no more than ten minutes behind the newest and its Dust grace period
  lasts until the transaction's TTL. When neither holds, balancing reads the newest block again every second, reserving
  nothing, and after two minutes fails with `SyncWalletError`, whose cause names the wallet's roots, the block's, and
  why the wallet's own block was refused. A `currentTime` the caller passes is used at once. When the newest block
  reports no roots at all, as the simulator's do, the spend is dated at it at once and a warning is logged. The V1
  variant's `BlockData` gains the optional `dustCommitmentMerkleTreeRoot` and `dustGenerationMerkleTreeRoot` the indexer
  reports. The facade's balancing and transfer methods document the possible wait.

- Updated dependencies [2e933df]
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-rc.2

## 5.0.0-rc.2

### Major Changes

- 1e0ea94: Breaking changes since 4.x

  - **Two ledger versions.** `DustWallet(configuration)` runs a ledger-v8 variant (V1) below `forks.v9` and a ledger-v9
    variant (V2) from it. At the crossing the Dust state starts empty and is rebuilt from the chain. `forks` is
    required, and `DefaultDustConfiguration` is declared by the package.
  - **Starting.** `DustWallet(configuration).startWithSeed(seed, rates?)` returns a `Promise`, and `startWithSecretKey`
    is replaced by `startWithKeys({ v8, v9 }, rates?)`. Generation rates are plain `DustGenerationRates` rather than
    ledger `DustParameters`, though either ledger version's `DustParameters` is still accepted; left out, they are the
    configured `dustParameters`, which default to ledger-v9's initial ones. A fresh start asks the chain the protocol
    version of its first block (`chainVersionProbe`, by default the indexer) to pick the variant; if the probe fails, it
    starts on V1. An instance's `start` takes `DustKeysByEpoch`, `{ v8, v9 }`, whichever variant it resumes on, and
    keeps them until `stop()`.
  - **Transacting.** `estimateFee` and `balanceTransactions` no longer take a secret key; after `stop()` they fail with
    `MissingStartAuxError`. `balanceTransactions` resolves `{ transaction, blockData }`, where `blockData` holds the
    ledger parameters the fee was priced with (typed `unknown` on `DustWalletAPI`; read them with the capabilities
    `withLedgerParameters`). Transactions are `WalletTransaction` handles; a handle for the other ledger version is
    refused with `ProtocolVersionMismatchError`, except by `revertTransaction`, which ignores it. Signatures, and the
    `nightVerifyingKey` that `createDustGenerationTransaction` and `attachDustRegistration` take, use the SDK's
    `Signing` types, and an ECDSA one is refused below `forks.v9`.
  - **API types.** `DustWalletAPI<TKeys = never, TSerialized>`: `start(keys)` takes the wallet's own keys type, and the
    API requires `stepSync` and `ensureFeeCoverage`. `DustWalletState.state` is sealed: read it with `coreStateOf` from
    `./v1` or `./v2`. The state loses `capabilities`, `services` and `mapState` (use `fromVariant`), and its constructor
    takes `(protocolVersion, state, projections)` in place of `(state, capabilities, services)`.
    `DustWalletCapabilities` and `DustWalletServices` are removed, and the shared types live in `DustWalletTypes`.
  - **Subpaths.** `./v1` exports the ledger-v8 variant and no longer the wallet API: import `DustWallet`,
    `CustomDustWallet`, `DustWalletAPI`, `DustWalletState` and `DefaultDustConfiguration` from the package root. Its
    `Simulator` is the capabilities `V8` simulator.
  - **`CustomDustWallet`** composes one ledger-v9 variant, from a V2 builder with ledger-v9 `DustParameters`, instead of
    a ledger-v8 one; its starts stay synchronous, its instance `start` takes `{ v9: key }`, and it cannot cross a fork.
  - **Custom sync and core state.** A `SyncService` declares how background synchronization repeats its `updates`, as a
    required `backgroundRepeat`: `BackgroundRepeat.Once()` for a long-lived subscription, or
    `BackgroundRepeat.WithDelay({ delay })`. Sync updates are tagged `Events` or `VersionSignal`, `applyUpdate` receives
    the protocol-version range its variant owns, and `BlockData` requires `protocolVersion`. A custom variant
    (`V1Variant`, `V2Variant`) must supply `startAux`, the `StartMaterial.StartAuxCapability` its builder sets with
    `withStartAux(Defaults)`, and takes an optional fifth type parameter for the previous variant's state.
    `CoreWallet.pendingDust` holds `PendingDust` entries (`{ coin, nullifier, declaredTime }`), and `DustWithNullifier`
    is removed. `CoreWallet` records which sync moved its position as a required `syncKind`
    (`'events' | 'projections'`), which `CoreWallet.restore` takes as its last argument.
  - **Errors.** The `WalletError` union of `./v1` and `./v2` gains `SnapshotRestoreError`, `OutOfOrderSyncUpdateError`
    and `InsufficientDustForFeeError`, and that of `./v2` also `SnapshotSyncMismatchError`, so an exhaustive match over
    it must handle them.
  - **Snapshots.** Snapshots are format `v2`, recording the variant that wrote them, the Dust still pending, and which
    sync saved their position (`syncKind`); 4.x snapshots are read and upgraded. Once this release has saved a wallet,
    going back to 4.x means restoring it from its seed. An unreadable snapshot is refused with `SnapshotRestoreError`
    instead of `Wallet.Other`, and `restore` throws that tagged error.
  - **Transaction history.** `txHistoryStorage` is a `DustHistoryStorage`, and a `DustTransactionHistoryEntry` is the
    common lifecycle entry with an optional `dust` section. A custom `TransactionHistoryService` returns
    `TransactionDetails` with the `block` (`hash`, `height`, `timestamp`), the transaction's `identifiers` and its
    `fees` in place of `timestamp`, and may fail with `BlocklessFinalizedEntryError`.
  - **Dependencies.** Depends on `@midnightntwrk/ledger-v9` `1.0.0-rc.7` beside `@midnight-ntwrk/ledger-v8`.

### Minor Changes

- 1e0ea94: Additions since 4.x

  - **Projections fast sync.** The `./v2` `SyncService.makeEventLessSyncService` synchronizes Dust from the indexer's
    projections instead of replaying every Dust event. It runs in finite passes, repeated in the background every
    `backgroundSyncInterval` (default 5 s); every pass, idle or not, re-resolves the wallet's nullifiers. It needs
    ledger-v9 and does not hand over across a fork by itself: compose it as the V2 sync of a `CustomForkingDustWallet`
    whose V1 variant replays events. A restored projections wallet resumes from the block its last pass reached. A
    wallet that replays events refuses a projections snapshot at restore with `SnapshotSyncMismatchError`
    (`Wallet.SnapshotSyncMismatch`) rather than misread its position; a `SyncService` declares what it `resumesFrom`,
    which both shipped services do. `SyncService.DustProjectionsUpdate` names the update it applies, so the composed
    wallet's type is `ForkingDustWallet<WalletSyncUpdate, DustProjectionsUpdate>`, with the first from `./v1`.
  - **Stepped sync.** `DustWallet.stepSync(keys)` runs one pass and returns; it completes only when the V2 variant uses
    a finite-pass sync such as the projections sync. Below `forks.v9`, where the V1 variant has no stepped sync, it
    rejects with `ManualSyncUnsupportedError` (`isManualSyncUnsupportedError`).
  - **Skipping the ledger-v8 history.** A fresh wallet on a chain that crossed `forks.v9` replays the ledger-v8 Dust
    events before it crosses, only to start empty on ledger-v9. With `skipLedgerV8DustHistory` it starts at the last
    Dust event below the boundary instead, so they are never replayed. **The wallet's ledger-v8 Dust transaction history
    will be missing.** Off by default; a restored wallet resumes from its snapshot, and when the search cannot be made
    the start proceeds without it. The `./v2` `SyncService.findDustTimelineStart` is the search, and
    `ForkingDustConfiguration.dustTimelineStartProbe` opts a `CustomForkingDustWallet` in.
  - **Fee coverage.** `InsufficientDustForFeeError` (`Wallet.InsufficientDustForFee`) reports that a first-time Dust
    registration cannot yet pay its own fee from the Dust its Night has generated: the `fee`, the `shortfall` and the
    `claimableFeePayment` in Specks, and an `estimate` of when generation will cover it (`Reachable`, with the seconds
    and the moment, or `Unreachable`, with the reason). One class serves both variants, so `instanceof` recognises it;
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

### Patch Changes

- 1e0ea94: Fixes and other changes since 4.x

  - `computeBalancingRecipe` no longer loops forever on a wallet holding several part-drained Dust coins. Each pass now
    covers the fee still unpaid over the coins not yet selected, and a pass that selects no coin fails instead of
    repeating. With the loop bounded, Dust the transactions already carry counts toward the fee; a transaction that
    already covers its fee gets an empty balancing transaction, where 4.x looped forever; a coin selection that exhausts
    the pool is retried once largest-first; and a selector that returns a coin it was not offered fails with
    `TransactingError`. `dryRunFee` takes an optional trailing parameter carrying the proof-erased, merged transactions,
    and with no inputs prices the transactions as they are rather than with an extra empty intent.
  - Reverting a transaction releases only the Dust it booked. It used to drop decaying Dust coins the transaction never
    spent, and release coins other pending transactions held. A coin a pending transaction spent stays pending through
    syncs, and in the snapshot, until the chain spends it, its lock runs out or it decays to nothing
    (`CoreWallet.settlePendingDust`).
  - A reordered event batch is refused whole, and the sync retries from the same position, instead of applying it.
  - A transaction's Dust history section is no longer dropped when its event arrives before the indexer can serve the
    transaction's details: the lookup is retried for `transactionDetailsRetryWindow` (default 2 minutes), and a section
    still missing after that is logged with its transaction hash. History lookups run at most eight at a time.
  - The sync's retry back-off is really capped at two minutes, with jitter. A second `start()` no longer starts a second
    sync. A Dust wallet syncing from a `Simulator` reports the chain tip and `isConnected`. A block the indexer cannot
    return is a typed error rather than a defect.

- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
- Updated dependencies [1e0ea94]
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0-rc.2
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-rc.1
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-rc.2
  - @midnightntwrk/wallet-sdk-indexer-client@2.0.0-rc.2
  - @midnightntwrk/wallet-sdk-runtime@2.0.0-rc.2
  - @midnightntwrk/wallet-sdk-utilities@1.3.0-rc.1

## 5.0.0-rc.1

### Major Changes

- 1660f24: Version every persisted format, read what earlier releases wrote, refuse the rest with a tagged error.

  ### Breaking
  - `finalizedBlock` is optional on `FinalizedLifecycle` and `FinalizedWalletEntry`; `isFinalizedWalletEntry` no longer
    implies one is present.
  - `InMemoryTransactionHistoryStorage.restore` throws `TransactionHistoryRestoreError` instead of returning an empty
    store; `tryRestore` returns it as a `Left`.
  - An unreadable snapshot is refused with `SnapshotRestoreError` (tag
    `@midnightntwrk/wallet-sdk-abstractions/SnapshotFormat/SnapshotRestoreError`), not `Wallet.Other`.
  - A finalized history entry with no block is reported as `BlocklessFinalizedEntryError` (tag
    `Wallet.BlocklessFinalizedEntry`), not `TransactionHistoryError`.
  - `upgradeV1ToV2` takes `readonly unknown[]`; `upgradeToCurrentFormat` returns an `Either`.

  ### Added
  - Histories are written as `{ version: 'v2', entries }`. Snapshots carry `version: 'v1'`, or `v2` for the unshielded
    V2 variant (key is `{ tag, value }`); a `v1` unshielded snapshot is upgraded on read. Unknown versions are refused
    by name.
  - Snapshots carry `writtenBy: 'v1' | 'v2'`. A snapshot is restored by its writer when that variant is registered and
    the protocol version is not below the writer's activation; otherwise by protocol version. An unshielded snapshot
    with no `writtenBy` and a bare-string key counts as written by V1.
  - Abstractions: `SnapshotFormat` (`versionField`, `writtenByField`, `isSnapshotWriter`, `readSnapshot`,
    `SnapshotRestoreError` with `surface`, `detectedVersion`, `reason`, `cause`), `SnapshotRouting` (`readEnvelope`,
    `routeSnapshot`), `TransactionHistoryFormat.detectVersion`; `TransactionHistoryRestoreError` carries a `reason`.
  - Facade exports `finalizedTransactionTraits`; dust exports `Serialization` from `/v1`.
  - CI gates persisted formats on drift, fixture coverage and frozen fixtures.

  ### Fixed
  - Histories saved by abstractions 2.1.0 or earlier restore; each entry gains a `finalized` lifecycle and, if missing,
    empty `identifiers`.
  - The `txHistory` embedded in a shielded 1.0.0 snapshot, and `coinHashesPending` written by V2, are no longer dropped
    by a reader; both survive the `forks.v9` crossing.
  - A V1 snapshot saved in the fork window now migrates: booked UTXOs released, `registeredForDustGeneration` cleared,
    stranded shielded spends released. Covers earlier snapshots for unshielded, from this release on for shielded and
    dust.
  - A V2 snapshot with a protocol version below V2's activation starts on V1 instead of failing with "No variant to
    init".
  - `restore` throws the tagged error `tryRestore` reports, not `getOrThrow called on a Left`.
  - `hasTTLExpired` applies the dust grace period only to transactions carrying shielded offers, and to transactions
    with no intents.
  - `NoOpTransactionHistoryStorage.serialize` writes `{ version: 'v2', entries: [] }`.

  Nothing saved by this release opens in abstractions 2.1.0.

### Minor Changes

- f1d84a7: feat: reject an underfunded dust registration with a typed `InsufficientDustForFeeError`

  `WalletFacade.registerNightUtxosForDustGeneration` used to reject a first-time registration whose generated dust could
  not yet pay its own fee with a plain `Error`, the amounts only in its message. It now rejects with
  `InsufficientDustForFeeError` (`_tag` `'Wallet.InsufficientDustForFee'`), part of the dust wallet's `WalletError`
  union in both variants. It carries `claimableFeePayment` (the fee payment the transaction was built with), `fee` and
  `shortfall` in Specks, and an `estimate` of when generation will cover the fee: `Reachable` with the seconds and the
  moment, or `Unreachable` with the reason (`NoGeneration`, `ExceedsCap`). The message keeps its old opening and always
  names `waitForGeneratedDust`: with a timeout long enough to see the estimate out when the fee is reachable, or saying
  it will not help when it is not. The booked Night UTxOs are still released before the rejection.

  Recognise it with `isInsufficientDustForFeeError(error)`, exported from the dust wallet package root: each variant
  declares its own class, so `instanceof` against one alone misses the other.

  The dust wallet gains `ensureFeeCoverage(currentTime, nightUtxos, feePayment, fee)`, which judges the attached fee
  payment and rejects with the error itself rather than a fiber wrapper, and `feeCoverageEstimate` on its
  coins-and-balances capability.

### Patch Changes

- 7ee351c: Fix `computeBalancingRecipe` looping forever instead of terminating on wallets holding several part-drained
  dust coins.

  The loop had no bound on the number of passes and no check that a pass had made progress. Its first pass was seeded
  with the transaction's dust imbalance, which is negative (a deficit); every later pass was seeded with the fee it had
  just computed, which is positive. `getBalanceRecipe` treats a non-negative seed as a surplus of dust — it adds a
  change output and selects zero inputs — so any wallet whose first pass under-covered its own fee looped forever,
  rebuilding and proof-erasing an identical transaction on every pass while its memory grew unbounded.

  Each pass now seeds the balancer with the outstanding deficit — the fee still unpaid by the coins already chosen and
  by the dust the transactions already carry — over the coins not yet selected, and passes the per-input fee measured so
  far as `inputFeeOverhead`, so the second pass normally completes what the first left short. A pass that consumes no
  coin fails instead of repeating, which bounds the loop by the pool size. Selected coins keep their selection order, so
  the fee is drained from the coins chosen first, as before.

  Behaviour that changes as a result, all of it previously unreachable because the loop hung first:

  - Dust the transactions already carry — existing spends, registration allowances — now counts toward coverage, so new
    inputs pay only the shortfall rather than the whole fee on top of it. The reported fee remains the total fee of the
    merged result, as `estimateFee` documents.
  - A transaction that already covers its fee produces no balancing intent. `balanceTransactions` returns an empty
    transaction, which merges as the identity, instead of an intent with empty `DustActions`, which the ledger rejects.
  - If the configured `coinSelection` exhausts the pool without covering the fee, selection is retried once
    largest-first: an additive selection is only guaranteed to find a covering set when it takes coins from the top. A
    selector that declines coins is never overridden and reports insufficient funds directly.
  - A selector that returns a coin it was not offered fails with `TransactingError` naming the mismatch, rather than
    pricing the same transaction repeatedly.

  `dryRunFee` gains an optional trailing parameter carrying the proof-erased, merged transactions so a caller pricing
  several input sets need not merge them once per set; with no inputs it now prices the transactions as they are rather
  than with an extra empty intent. No other public API changes.

- d0f38b3: fix: report the protocol version a restored or probe-started wallet's state records (#774)

  A wallet started from a state it already held (every `restore`/`tryRestore`, and every fresh start with a
  `chainVersionProbe` configured) reported its variant's lower bound instead of the chain's version, and never corrected
  it: on ledger-v8 it reported `0`, on ledger-v9 `forks.v9`. The wrong value reached
  `WalletFacade.activeProtocolVersion` and the `protocolVersion` stamped on every recipe and transaction the facade
  built. Such a wallet now reports the version its state records, as a wallet that crossed the boundary by hand-over
  always did.

  **Breaking (runtime):** `Variant` requires `protocolVersionOf(state)`, returning the protocol version a state of the
  variant records. The runtime reads it when it starts a variant from existing state, and never reports a version below
  the variant's activation range. A variant whose state keeps no version answers `ProtocolVersion.MinSupportedVersion`,
  which starts it at its lower bound as before. The variants of the unshielded, shielded and dust wallets implement it.

- 56542fa: fix: keep a transaction's stamp when a wallet signs or balances it in place (#797)

  A wallet that changed a transaction it was handed re-stamped it at the lowest version of its epoch (`0` below
  `forks.v9`, `forks.v9` from it), whatever the transaction came in with. So a transaction adopted at the version the
  chain reports, as `WalletFacade.adoptTransaction` does, came back from `signRecipe` with a different
  `protocolVersion`, and a recipe with nothing to sign no longer equalled the one handed over. The side of the fork
  never changed, so nothing was routed differently.

  Methods that change the transaction they are handed now return it with the stamp it came in with: the unshielded
  wallet's `signUnprovenTransaction`, `signUnboundTransaction`, `balanceUnprovenTransaction` and
  `balanceUnboundTransaction`, and the dust wallet's `attachDustRegistration`, `addDustGenerationSignature` and
  `addDustRegistrationSignature`, on both variants and in the single-variant `CustomUnshieldedWallet` /
  `CustomDustWallet`. Transactions a wallet builds itself are stamped as before.

- Updated dependencies [d0f38b3]
- Updated dependencies [7ee351c]
- Updated dependencies [7ee351c]
- Updated dependencies [7ee351c]
- Updated dependencies [1660f24]
  - @midnightntwrk/wallet-sdk-runtime@2.0.0-rc.1
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-rc.1
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0-rc.1
  - @midnightntwrk/wallet-sdk-indexer-client@2.0.0-rc.1

## 5.0.0-rc.0

### Patch Changes

- db9102e: chore: cut the first 2.x release candidate — republish the v2 line under the `rc` dist-tag
- Updated dependencies [db9102e]
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0-rc.0
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-rc.0
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-rc.0
  - @midnightntwrk/wallet-sdk-indexer-client@2.0.0-rc.0
  - @midnightntwrk/wallet-sdk-runtime@1.1.0-rc.0
  - @midnightntwrk/wallet-sdk-utilities@1.2.2-rc.0

## 5.0.0-beta.4

### Major Changes

- 94c69ec: feat(dust-wallet)!: run the projections dust sync in the background

  The projections ("event-less") sync synchronizes in finite passes, where the event-based service holds a long-lived
  subscription — so a wallet built on it converged once and observed nothing further. Background synchronization now
  repeats those passes, each resuming from what the last applied.

  **Breaking:** every `SyncService` now states how often background synchronization runs its `updates`, as a required
  `backgroundRepeat` of `BackgroundRepeat.Once()` — the answer for a long-lived subscription, which is every service the
  SDK ships bar one — or `BackgroundRepeat.WithDelay({ delay })`. A custom sync service must add the field.

  The projections service is `WithDelay`, configurable as `backgroundSyncInterval` (milliseconds, default 5000). An idle
  pass still re-resolves the wallet's nullifiers, so the interval costs more on a wallet holding Dust than on an empty
  one. `facade.doSync()` is unchanged: one pass, then it returns.

  Repeating a pass exposed four defects, fixed here:

  - A pass emitted one update per resolved Dust spend into a buffer bounded at 16 that nothing drains until the pass
    returns, so a wallet past roughly ten spends deadlocked silently. It is now unbounded.
  - Three of a pass's four progress reports dropped a term the fourth counted, flipping `isSynced` on every repeat for a
    wallet that had already caught up.
  - Each pass rebuilt the source's indexer clients into the wallet's scope and released none until the wallet stopped.
    Passes now get their own scope; the tx-history fan-out stays on the wallet's.
  - A second `start()` forked a second poller, since the sync lock is released between passes. A worker-lifetime guard
    makes it a no-op.

  Separately, a failing pass now genuinely backs off at most two minutes, with jitter. Neither bound applied before, so
  the delay doubled without limit into days.

  Only the ledger-v9 twin's projections service is `WithDelay`: the finite-pass sync, and the buffer fix it needed,
  remain ledger-v9 capabilities.

  The testkit adds `eventLessDustWallet`, `eventBasedDustWallet`, `projectionsDustSyncOptions` and `DustWalletFactory`,
  plus `dustWallet`/`manualSync` options on `provideWallet`, `initWalletWithSeed` and the dust and token-transfer
  scenarios. Purely additive.

### Patch Changes

- 0bf816a: fix(dust): reject a reordered event batch instead of applying it

  Addresses the Least Authority audit suggestion "Handle Sync Updates Defensively" (25 March 2026) for the Dust wallet's
  event sync. After dropping the boundary event the inclusive cursor re-delivers, a batch must arrive in strictly
  ascending id order. A batch with an id at or below its predecessor, or at or below the cursor, is refused whole with
  the new tagged `OutOfOrderSyncUpdateError` (`Wallet.OutOfOrderSyncUpdate`, carrying `expected` and `received`):
  nothing in it is applied and the cursor does not move. The running variant logs the error and retries from the same
  cursor.

  Only order is checked, never contiguity: in the indexer, dust events share one id sequence with zswap and contract
  events, so gaps in a dust stream are normal. A skipped commitment-inserting event is still caught by the ledger's own
  insertion check. Applies to both the V1 and V2 variants; the projections sync path is unchanged.

- ac825c0: chore: upgrade `@midnightntwrk/ledger-v9` to 1.0.0-rc.5 (proof server stays at 9.0.0-rc.7, the build
  ledger-v9 rc.5 declares)
- Updated dependencies [7025e69]
- Updated dependencies [ac825c0]
- Updated dependencies [12ca8b1]
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0-beta.2
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-beta.4
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-beta.4
  - @midnightntwrk/wallet-sdk-runtime@1.1.0-beta.2

## 5.0.0-beta.3

### Major Changes

- b9c1150: Hard-fork support. A wallet runs `@midnight-ntwrk/ledger-v8` below the chain's fork version and
  `@midnightntwrk/ledger-v9` from it, and follows a live chain across that boundary: balances, coins and transaction
  history survive the crossing, and a wallet restored from a snapshot crosses too. Applications no longer import a
  ledger package directly.

  ### Breaking: configuration
  - `forks: { v9 }` is the protocol version from which ledger-v9 reads the chain. `ProtocolVersion.V9NativeForkVersion`
    (2000000) is the value a 2.x node reports, and `ProtocolVersion.V9NativeForkSchedule` is
    `{ v9: V9NativeForkVersion }`. The facade presets it as `DefaultForkSchedule` when `forks` is left out of the
    configuration and hands the completed configuration to every factory in `InitParams`;
    `WalletFacade.resolveConfiguration(configuration)` returns the same for code outside a factory. `ShieldedWallet`,
    `UnshieldedWallet` and `DustWallet` require `forks`.
  - `provers: { v8?, v9 }` names a proving backend per ledger version, each `{ kind: 'server', url }` or
    `{ kind: 'wasm' }`. `provingServerUrl` remains the shorthand for one proof server under both keys; `provers` wins
    when both are given, and naming neither fails with `ProvingConfigurationError`. A transaction whose version has no
    backend fails with `UnsupportedProvingVersionError`. No published proof-server image serves both ledger versions, so
    a chain with ledger-v8 history wants a server per key; the in-process prover serves both.
  - `chainVersionProbe` (optional, all three wallets) asks on every start which protocol version the chain's first block
    was produced under, so the wallet starts on the matching ledger version; the default asks the indexer. A failed
    probe never fails a start: the wallet starts on ledger-v8 and crosses on its first synced update.

  ### Breaking: starting a wallet
  - Wallets start from seeds. `WalletSeeds.fromMasterSeed(masterSeed, { account?, addressIndex?, unshieldedRole? })`
    derives the shielded, dust and unshielded seeds and throws `SeedDerivationError` for a seed it cannot read.
    `ShieldedWallet(...)` and `DustWallet(...)` gain `startWithSeed(seed)` and `startWithKeys({ v8, v9 })`, both
    returning a `Promise`; `startWithSecretKeys` and `startWithSecretKey` are removed. The unshielded
    `startWithPublicKey` also returns a `Promise`. The single-ledger `CustomShieldedWallet` and `CustomDustWallet` keep
    their synchronous starts and cannot cross a fork.
  - `WalletFacade.start` takes `WalletSeeds` or `FacadeKeysByEpoch`
    (`{ v8: { shielded, dust }, v9: { shielded, dust } }`), and its third argument is now `{ manualSync?: boolean }`;
    `doSync` takes the same start material.
  - The `secretKeys` parameter is gone from every transaction-building method. A stopped wallet drops its key material,
    so transacting after `stop()` fails with `MissingStartAuxError`.
  - `DustWallet(...).startWithSeed(seed, dustParameters?)` and `DefaultDustConfiguration.dustParameters` take a plain
    `DustGenerationRates` object and default to the ledger's initial parameters.
  - Snapshots restore on whichever ledger version wrote them. `tryRestore` returns the reason a snapshot cannot be read
    instead of throwing; the dust wallet adds `peekProtocolVersion` and `UnsupportedSnapshotVersionError`; the shielded
    `Restore` and unshielded `UnshieldedRestore` namespaces inspect a snapshot.

  ### Breaking: transactions carry the version that built them
  - Every facade and wallet method that took or returned a ledger transaction now uses `WalletTransaction`, a handle
    that records the protocol version the transaction was built for. A handle for the other ledger version is refused
    with `ProtocolVersionMismatchError`. Applications that build their own transactions import
    `@midnightntwrk/wallet-sdk/ledger/v8` or `/ledger/v9` and seal the result with
    `WalletTransaction.adopt('Unproven', tx, protocolVersion)`; handles serialize with `toWire` and `fromWire`.
  - `finalizeTransaction` and `finalizeRecipe` stamp the version the transaction was authored at, not the version
    reached while it was being proved. If the chain moved to the other ledger version during proving, they fail with
    `ProtocolVersionMismatchError` and release the coins the transaction had reserved.
  - `FacadeState.pending` is an array of `{ transaction, submittedAt, authoredFor, status }`, with `status` one of
    `Submitted`, `Confirmed`, `Rejected` or `Orphaned`. A transaction still pending when the chain crosses is orphaned:
    it can never be included, so its coins are released and history records the rejection with reason
    `orphaned-by-protocol-upgrade`. `revert` and `revertTransaction` accept an optional reason.
  - A verdict that arrives after a transaction has already landed, such as a late pending-status check, an expired TTL
    or the protocol upgrade orphaning it, clears the pending entry rather than recording a rejection, and an included
    failure still releases the coins it had reserved. History storage implementations must give a recorded inclusion
    precedence over a later rejection: `gotRejected` writes nothing for a transaction a finalized entry already covers,
    `gotFinalized` clears every pending or rejected entry it covers under another hash, and
    `TransactionHistoryStorage.coversTransaction` is the predicate. `mergeWalletEntries` keeps a finalized entry over an
    incoming rejected one.
  - The facade recipes and `BlockData` gain a required `protocolVersion`. Proving, validation and ledger-parameter reads
    route on the transaction's version.

  ### Behaviour at the fork
  - `FacadeState.protocolVersion`, `activeProtocolVersion` and `protocol` report where the wallets are: `Settled`
    (`{ version }`) or `Crossing` (`{ from, to, behind }`).
  - The shielded wallet carries its coins across at their positions in the commitment tree. Commitments and nullifiers
    are recomputed on the first synced update after the crossing, so until then `balances`, `availableCoins` and
    `pendingCoins` read empty. Coins booked for a ledger-v8 transaction still in flight at the crossing are released in
    that same update, since nothing on ledger-v9 can include that transaction; its change outputs stay in
    `pendingOutputs` and overstate the pending balance. The dust wallet starts empty and rebuilds from the chain.
    Unshielded UTxOs booked by transactions still pending return to the available balance.
  - A wallet with no traffic of its own still notices the fork. The unshielded wallet reads the version off its sync
    progress; the shielded and dust wallets re-ask the chain's tip on a timer
    (`DefaultSyncConfiguration.versionWatch.intervalMs`, default 30 s, zero or less disables). The recorded protocol
    version only ever increases.
  - Carried Night UTxOs cross with `registeredForDustGeneration: false`, matching what the indexer reports, so
    re-register them on ledger-v9. `claimableFeePayment(dustState, nightUtxos, now)` gives the amount
    `waitForGeneratedDust` waits on.
  - Known limitations: the dust projections-based fast sync does not hand over at a fork on its own, and a fresh dust
    wallet on a chain that forked over history replays the ledger-v8 dust events before crossing.

  ### Breaking: renamed exports

  Everything typed by one ledger version now says which in its name, so the ledger-v8 counterparts can sit next to it.
  In `@midnightntwrk/wallet-sdk-capabilities/proving` and `/validation`, also reachable through
  `@midnightntwrk/wallet-sdk/capabilities/proving`:

  | Before                                                               | After                                                            |
  | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
  | `fromProvingProvider`, `fromProvingProviderEffect`                   | `fromV9ProvingProvider`, `fromV9ProvingProviderEffect`           |
  | `makeServerProvingService`, `makeServerProvingServiceEffect`         | `makeV9ServerProvingService`, `makeV9ServerProvingServiceEffect` |
  | `makeWasmProvingService`, `makeWasmProvingServiceEffect`             | `makeV9WasmProvingService`, `makeV9WasmProvingServiceEffect`     |
  | `UnboundTransaction`                                                 | `V9UnboundTransaction`                                           |
  | `AnyValidatableTransaction`                                          | `AnyV9ValidatableTransaction`                                    |
  | `makeDefaultValidationService`, `makeDefaultValidationServiceEffect` | `makeV9ValidationService`, `makeV9ValidationServiceEffect`       |

  `@midnightntwrk/wallet-sdk-shielded` re-exports `V9UnboundTransaction` in place of `UnboundTransaction`. The versioned
  `makeDefaultVersionedValidationService` and `makeDefaultVersionedValidationServiceEffect` keep their names.

  ### Breaking: package APIs

  For code that composes wallets or test fixtures by hand.

  - Each wallet package exports the ledger-v8 wallet on `./v1` and the ledger-v9 wallet on `./v2` (`shielded/v1`,
    `shielded/v2`, and likewise `dust` and `unshielded`, in `@midnightntwrk/wallet-sdk`), with `V1`- and `V2`-named
    exports. The dust `./v1` has no projections-based fast sync; the unshielded `./v1` has its own `createKeystore`
    taking a plain `Uint8Array`, and no ECDSA. Both subpaths export a `Migration` namespace, and their builders gain
    `withStartAux`, `withStartAuxDefaults`, `withMigration` and `withMigrationDefaults`.
  - `ShieldedWalletState`, `DustWalletState` and `UnshieldedWalletState` lose `capabilities`, `services` and `mapState`;
    `fromVariant` replaces it. Shielded `BalancingResult` is renamed `ShieldedBalancingResult`.
    `DefaultShieldedConfiguration`, `DefaultDustConfiguration` and `DefaultUnshieldedConfiguration` are declared by each
    package; the testkit's configuration types follow.
  - Sync updates are tagged unions (`_tag` for shielded and dust, `type` for unshielded) with a `VersionSignal` member.
    A custom sync capability receives the protocol-version range it owns as a third `applyUpdate` argument and must
    leave updates beyond it unapplied.
  - Capabilities: proving and validation are `VersionedProvingService` and `VersionedValidationService`
    (`validateTx(tx, protocolVersion, options)`); `makeDefaultVersionedProvingService` and
    `makeDefaultVersionedValidationService` take the fork schedule as their second argument, and `ProvingBackends` is
    the type of `provers`. A backend handed the other ledger version's transaction fails with
    `ProvingEpochMismatchError`. New subpaths `./chainVersion` (`makeIndexerChainVersionProbe`), `./codecs`
    (`LedgerParametersCodec`) and `./signatures` (`Signing`). Pending transactions are versioned:
    `addPendingTransaction(tx, protocolVersion)` and `orphanBeyond(chainNow)`. Simulation has a simulator per ledger
    version, `V8` and `V9`, and `ForkSimulator` drives one chain across a boundary.
  - Abstractions: `ProtocolVersion.ForkSchedule`, `ProtocolVersion.Registry` and `ProtocolVersion.epochOf`;
    `ProtocolState` requires a `variantTag`. Runtime: `withVariant(sinceVersion, builder, configuration?)`,
    `VariantContext.activationRange` and `Runtime.onVariantActivation`. Indexer client: `protocolVersion` on
    `BlockHash`, `DustLedgerEvents`, `DustNullifierTransactions` and the unshielded progress frame, and the id-only
    subscriptions `ZswapEventTip` and `DustLedgerEventTip`. Prover client: `asV8ProvingProvider()` next to
    `asV9ProvingProvider()`, and `WasmProver.makeDefaultKeyMaterialProvider({ circuits })` to pick the circuit line.
  - `@midnightntwrk/wallet-sdk` gains the `ledger/v8`, `ledger/v9` and `capabilities/codecs` subpaths, and its root
    exports `Token.night`, `parseTokenType`, `Signing`, and `DustGenerationRates` with `asV8DustParameters` and
    `asV9DustParameters`, so token types, signatures and dust parameters need no ledger import.

  ### Dependencies
  - `@midnightntwrk/ledger-v9` `1.0.0-rc.4`. Its dust spend circuit differs from rc.3, so run proof server `9.0.0-rc.7`,
    the build the rc.4 ledger declares; the `./testing` containers in `@midnightntwrk/wallet-sdk-utilities` default to
    it.
  - `@midnight-ntwrk/ledger-v8` is a runtime dependency of the capabilities, wallet, facade, prover-client, testkit and
    umbrella packages, so browser bundles load two ledger WASM modules.

### Patch Changes

- 1cf94a3: Filter foreign dust nullifier transactions before decoding and avoid double-wrapping expected missing-block
  errors during dust synchronization.
- 5d25685: fix: keep tx-history shielded/dust sections when the indexer lags events (#401)

  When a WS event arrived before the indexer's HTTP endpoint had ingested the tx, `getTransactionDetails` dereferenced
  an empty result and died with an unretriable `TypeError`, so the shielded/dust section was silently dropped
  (balances/coins were unaffected). It now fails typed and retries over a bounded, configurable window
  (`transactionDetailsRetryWindow`, default 2 min); beyond it the loss is logged (`Effect.logError` with the `txHash`)
  instead of swallowed, and the sync fan-out is capped (`concurrency: 8`). This narrows the race but is not a durability
  guarantee: if the indexer lags beyond the window the section is still lost (not re-processed), just logged rather than
  swallowed.

- Updated dependencies [5d25685]
- Updated dependencies [b9c1150]
  - @midnightntwrk/wallet-sdk-indexer-client@2.0.0-beta.2
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0-beta.1
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-beta.3
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-beta.3
  - @midnightntwrk/wallet-sdk-runtime@1.1.0-beta.1
  - @midnightntwrk/wallet-sdk-utilities@1.2.2-beta.0

## 5.0.0-beta.2

### Patch Changes

- 3c06af2: chore: upgrade ledger to 1.0.0-rc.3
- Updated dependencies [3c06af2]
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-beta.2
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-beta.2

## 5.0.0-beta.1

### Minor Changes

- e89ab0b: Track transaction lifecycle in transaction history. Submitted transactions are now recorded as pending,
  transition to finalized once confirmed by the indexer, and to rejected if they are reverted — giving a single,
  consistent view of in-flight and settled transactions.

### Patch Changes

- 1eaad77: Pin internal `@midnightntwrk/wallet-sdk-*` dependencies to exact versions instead of caret ranges. A caret
  range on a prerelease base (e.g. `^5.0.0-beta.0`) satisfies canary snapshots published on the same `major.minor.patch`
  (`5.0.0-canary.*`), and since `canary` sorts above `beta`/`alpha`, installing a prerelease pulled canary builds of the
  sibling packages. Exact pins make published releases resolve to a single coherent set regardless of what snapshots
  exist on the registry.
- 057701e: fix: pins internal dependencies
- Updated dependencies [e89ab0b]
- Updated dependencies [1eaad77]
- Updated dependencies [057701e]
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0-beta.0
  - @midnightntwrk/wallet-sdk-indexer-client@1.3.0-beta.1
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-beta.1
  - @midnightntwrk/wallet-sdk-runtime@1.0.6-beta.0
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-beta.1

## 5.0.0-beta.0

### Major Changes

- ef16433: **BREAKING:** `DustWalletAPI.balanceTransactions` now returns
  `{ transaction: UnprovenTransaction; blockData: BlockData }` instead of `UnprovenTransaction`. Callers must read the
  transaction from the `transaction` field; the accompanying `blockData` (hash, height, timestamp, ledger parameters)
  captured during balancing can be reused downstream to avoid a redundant fetch.

  Also exposes the `BlockData` type from the package's public surface.

- ce4cd19: Migrate from `@midnight-ntwrk/ledger-v8` to `@midnightntwrk/ledger-v9`.

  Ledger v9 changes `SigningKey`, `SignatureVerifyingKey`, and `Signature` from plain strings (implicitly schnorr) to
  tagged objects (`{ tag: 'schnorr' | 'ecdsa', value }`), adding ecdsa support alongside schnorr. Consequences for SDK
  users:

  - `createKeystore` now takes an `UnshieldedSecretKey` (`{ kind: 'schnorr' | 'ecdsa', secret }`) instead of a raw
    `Uint8Array` seed, and `UnshieldedKeystore.getPublicKey()` / `PublicKey.publicKey` return the tagged
    `SignatureVerifyingKey`.
  - Serialized unshielded wallet state now stores the verifying key together with its signature kind. Snapshots produced
    with the v8-based SDK (plain-string key) still deserialize and default to `schnorr`.
  - Own-input extraction (used by transaction revert) compares verifying keys structurally, and dust
    generation/registration signing wraps signatures in the v9 `SignatureEnabled` marker.

  Consumers must resolve `@midnightntwrk/ledger-v9` instead of `@midnight-ntwrk/ledger-v8`.

### Patch Changes

- Updated dependencies [44bbcae]
- Updated dependencies [ce4cd19]
- Updated dependencies [ef16433]
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.4-beta.0
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-beta.0
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-beta.0

## 4.2.0

### Minor Changes

- dff5706: Fix a race in `WalletFacade.registerNightUtxosForDustGeneration` where the registration's `allow_fee_payment`
  could be below its own fee, causing the chain to reject submission with `BalanceCheckOverspend`. The wallet now
  estimates the fee at build time, reverts the booking, and throws before submission. Adds
  `WalletFacade.waitForGeneratedDust(utxos, requiredAmount, opts?)` so callers can defer registration until enough dust
  has accrued — pair with `estimateRegistration` to pick the threshold.

### Patch Changes

- Updated dependencies [417d042]
- Updated dependencies [0b41e11]
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.3
  - @midnightntwrk/wallet-sdk-runtime@1.0.5

## 4.1.0

### Minor Changes

- 6e187fe: Fix a race where Dust registration / deregistration would double-use Night UTxOs that another in-flight
  transaction was already trying to spend. The build flow now books the chosen Night UTxOs (available → pending) at
  build time, so a conflicting concurrent build fails immediately with `SpendUtxoError` instead of only at submission.
  Adds new methods on `UnshieldedWallet` (`rotateUtxos`) and `DustWallet` (`splitNightUtxosForDustRegistration`,
  `attachDustRegistration`) to support the split build.

### Patch Changes

- 0fd0062: Fix dust fee balancing failing with `InsufficientFunds` despite ample dust (issue #383). Two compounding
  defects in the dust wallet's coin selection:
  - The local `chooseCoin` now skips zero-value coins, so a freshly-registered dust UTXO with `generatedNow === 0` no
    longer wastes an iteration as the smallest candidate. The local `CoinSelection` type and `chooseCoin` signature were
    realigned with the capabilities `CoinRecipe` API, and the variant now passes its configured coin selection through
    to `getBalanceRecipe`. Note: `CoinsAndBalances.CoinSelection` is no longer parametrized — it changed from
    `CoinSelection<TInput>` to a polymorphic `CoinSelection`. The prior wiring was non-functional (the variant's
    `coinSelection` slot was never invoked), so any consumer who customized it had no observable behavior; only the type
    reference needs updating.
  - `computeBalancingRecipe` now identifies coins by `token.nonce` rather than by `value` when removing the just-picked
    coin from the working set. Value-equality previously caused a single pick to drop the entire cohort of dust UTXOs
    sharing the same `generatedNow` (a routine outcome once their backing Night UTXOs reach `maxCap`), making most of
    the wallet's spendable dust invisible to the balancer.

- 7452e96: Bump `@midnight-ntwrk/ledger-v8` from `^8.0.3` to `^8.1.0`. Internal balancing flows in `dust-wallet`,
  `unshielded-wallet`, and `shielded-wallet` are refactored to use the new ledger 8.1.0 builder API
  (`Transaction.addIntent`, `Transaction.addZswapOffer`) instead of post-construction field mutation on
  `Transaction.fromParts(...)`. No public API changes; consumers must resolve `@midnight-ntwrk/ledger-v8` to `>=8.1.0`.
- 25f58b4: Widen ranges for internal `@midnightntwrk/wallet-sdk-*` dependencies from exact versions to caret ranges so
  consumers can dedupe shared sibling packages into a single installed copy.
- Updated dependencies [6e187fe]
- Updated dependencies [7452e96]
- Updated dependencies [25f58b4]
  - @midnightntwrk/wallet-sdk-utilities@1.2.0
  - @midnightntwrk/wallet-sdk-address-format@3.1.2
  - @midnightntwrk/wallet-sdk-capabilities@3.3.1
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.2
  - @midnightntwrk/wallet-sdk-runtime@1.0.4

## 4.0.0

### Major Changes

- 55715af: **BREAKING:** `getAvailableCoins`, `getPendingCoins`, and `getTotalCoins` now return `DustFullInfo` (with
  generation details) instead of raw `Dust`. Access the underlying `Dust` via the `.token` property. Removes
  `getAvailableCoinsWithFullInfo`, `getPendingCoinsWithFullInfo`, and `getTotalCoinsWithFullInfo`. The methods now
  accept an optional `time` parameter, defaulting to `syncTime`.
- 3763803: Add txHistory functionality to the dust wallet

### Patch Changes

- e57a94b: Unify Simulator into capabilities package with proper fee payment and block production model
- c1ae369: Fix transaction history race condition by consolidating merge logic in the facade and delegating it to
  storage at construction time.
- eba8e08: Expose CustomDustWallet factory and generic types (CustomizedDustWallet, CustomizedDustWalletClass) to allow
  custom variant builders, matching the shielded and unshielded wallet patterns
- 8383f7b: Remove the double exporting of TransactionHistory.js
- 1f794fa: feat: deterministically set balancing tx segment id

  Replaced `Transaction.fromPartsRandomized` with `Transaction.fromParts` + explicit `intents.set(segmentId, intent)`
  when building balancing transactions, where `segmentId` is the lowest unused fallible segment in `[1, 65535]`. This
  makes segment placement deterministic and reproducible instead of random.
  - **dust-wallet**: `dryRunFee` and `balanceTransactions` now merge the existing (proof-erased) transactions first,
    then pick a segment that doesn't collide with any of them before constructing the balancing tx. A new exported
    `findAvailableSegmentId` helper in `Transacting.ts` drives the lookup.
  - **unshielded-wallet**: `balanceFinalizedTransaction` picks a segment that doesn't collide with the passed-in
    `FinalizedTransaction` before constructing the balancing tx. `findAvailableSegmentId` was added as a method on
    `TransactionOps`.

- 0db3290: chore: bump ledger version to 8.0.3
- 0529e6a: Add `batchUpdates` option to `DefaultSyncConfiguration` for controlling sync stream batching (size, timeout,
  and spacing between batches)
- 7f82432: Introduce a shared transaction history storage layer with support for wallet-specific augmentation.
  Reimplement shielded wallet transaction history and refactor unshielded wallet transaction history to use the new
  shared storage.
- Updated dependencies [e57a94b]
- Updated dependencies [c1ae369]
- Updated dependencies [0db3290]
- Updated dependencies [7f82432]
  - @midnightntwrk/wallet-sdk-capabilities@3.3.0
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.1
  - @midnightntwrk/wallet-sdk-abstractions@2.1.0
  - @midnightntwrk/wallet-sdk-address-format@3.1.1
  - @midnightntwrk/wallet-sdk-utilities@1.1.1
  - @midnightntwrk/wallet-sdk-runtime@1.0.3

## 3.0.0

### Major Changes

- 07ea767: fix: dynamic fee calculation including balancing transaction costs
  - Split `calculateFee` into two methods:
    - `calculateFee` — estimates the fee for a given transaction only (no balancing transaction costs)
    - `estimateFee` — calculates the total fee including the balancing transaction, requiring a secret key, wallet
      state, and TTL
  - Updated `WalletFacade` to expose `calculateTransactionFee` and an updated `estimateTransactionFee` that accepts a
    secret key and optional TTL/currentTime
  - Removed fee overhead constant; fees are now dynamically calculated based on actual coin selection
  - Updated `CoinSelection` type to return a single coin (smallest available) instead of multiple coins summed to a
    target amount
  - Added `InsufficientFundsError` to `WalletError` for cases where balancing cannot cover the fee

### Minor Changes

- aa7b1f4: chore: update ledger to v8

### Patch Changes

- 372d964: fix: optimize balancing error message reporting
- 1ad34a9: fix: clear ZswapSecretKeys from memory after use instead of only nullifying the reference
- Updated dependencies [9d71d25]
- Updated dependencies [ea55591]
- Updated dependencies [aa7b1f4]
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.0
  - @midnightntwrk/wallet-sdk-utilities@1.1.0
  - @midnightntwrk/wallet-sdk-address-format@3.1.0
  - @midnightntwrk/wallet-sdk-capabilities@3.2.0
  - @midnightntwrk/wallet-sdk-runtime@1.0.2

## 3.0.0-rc.0

### Major Changes

- 07ea767: fix: dynamic fee calculation including balancing transaction costs
  - Split `calculateFee` into two methods:
    - `calculateFee` — estimates the fee for a given transaction only (no balancing transaction costs)
    - `estimateFee` — calculates the total fee including the balancing transaction, requiring a secret key, wallet
      state, and TTL
  - Updated `WalletFacade` to expose `calculateTransactionFee` and an updated `estimateTransactionFee` that accepts a
    secret key and optional TTL/currentTime
  - Removed fee overhead constant; fees are now dynamically calculated based on actual coin selection
  - Updated `CoinSelection` type to return a single coin (smallest available) instead of multiple coins summed to a
    target amount
  - Added `InsufficientFundsError` to `WalletError` for cases where balancing cannot cover the fee

### Minor Changes

- aa7b1f4: chore: update ledger to v8

### Patch Changes

- 372d964: fix: optimize balancing error message reporting
- Updated dependencies [9d71d25]
- Updated dependencies [ea55591]
- Updated dependencies [aa7b1f4]
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.0-rc.0
  - @midnightntwrk/wallet-sdk-utilities@1.1.0-rc.0
  - @midnightntwrk/wallet-sdk-address-format@3.1.0-rc.0
  - @midnightntwrk/wallet-sdk-capabilities@3.2.0-rc.0
  - @midnightntwrk/wallet-sdk-runtime@1.0.2-rc.0

## 2.0.0

### Major Changes

- f52d01d: - expose functions for reverting pending coins (booked for a pending transaction) from a provided transaction
  - extract submission into `@midnightntwrk/wallet-sdk-capabilities` package as a standalone service and integrate it
    into the `WalletFacade`
  - make `WalletFacade` revert transaction upon submission failure
  - change initialization of `WalletFacade` to a static async method `WalletFacade.init` taking a configuration object.
    This will allow non-breaking future initialization changes when e.g. new services are being integrated into the
    facade.
- d3422bc: - Extract proving into a standalone `ProvingService` in the `@midnightntwrk/wallet-sdk-capabilities` package,
  decoupling it from the shielded and dust wallet builders. The new service supports server (HTTP prover), WASM, and
  simulator proving modes via a unified configuration.
  - Remove `withProving` / `withProvingDefaults` and the `provingService` dependency from the V1 builders in both the
    shielded and dust wallet packages. Proving is no longer a wallet-level concern.
  - Integrate the `ProvingService` into `WalletFacade`, which now owns transaction proving and finalization. On proving
    failure the facade reverts the transaction across all three wallet types (shielded, unshielded, dust).

  ### Breaking changes
  - **`@midnightntwrk/wallet-sdk-shielded`**: Removed `finalizeTransaction` from `ShieldedWalletAPI`. Removed `Proving`
    export from `@midnightntwrk/wallet-sdk-shielded/v1`. Removed `provingService` from the V1 builder and
    `RunningV1Variant.Context`. Removed `withProving` / `withProvingDefaults` from `V1Builder`. `DefaultV1Configuration`
    no longer includes `DefaultProvingConfiguration`.
  - **`@midnightntwrk/wallet-sdk-dust-wallet`**: Removed `proveTransaction` from `DustWalletAPI`. Removed
    `provingService` from the V1 builder and `RunningV1Variant.Context`. Removed `withProving` / `withProvingDefaults`
    from `V1Builder`.
  - **`@midnightntwrk/wallet-sdk-facade`**: Removed the `UnboundTransaction` type export (now re-exported from
    `@midnightntwrk/wallet-sdk-capabilities/proving`). `WalletFacade` now requires a `ProvingService` and
    `DefaultConfiguration` includes `DefaultProvingConfiguration`.

- 1409b6b: Standardize wallet APIs across shielded, unshielded, and dust wallets

  ### Breaking Changes

  **Dust Wallet:**
  - Rename `DustCoreWallet` to `CoreWallet` for consistency
  - Rename `walletBalance()` to `balance()` on `DustWalletState`
  - Rename `dustPublicKey` to `publicKey` and `dustAddress` to `address` on state objects
  - Rename `getDustPublicKey()` to `getPublicKey()` and `getDustAddress()` to `getAddress()` on `KeysCapability`
  - Add `getAddress(): Promise<DustAddress>` method to `DustWalletAPI`
  - Change `dustReceiverAddress` parameter type from `string` to `DustAddress` in transaction methods

  **Shielded Wallet:**
  - Rename `startWithShieldedSeed()` to `startWithSeed()` for consistency
  - Add `getAddress(): Promise<ShieldedAddress>` method
  - Change `receiverAddress` parameter type from `string` to `ShieldedAddress` in transfer methods
  - Transaction history getter now throws "not yet implemented" error

  **Facade:**
  - `TokenTransfer` interface now requires typed addresses (`ShieldedAddress` or `UnshieldedAddress`) instead of strings
  - Split `CombinedTokenTransfer` into `ShieldedTokenTransfer` and `UnshieldedTokenTransfer` types
  - Address encoding/decoding is now handled internally - consumers pass address objects directly

  ### Migration Guide

  **Before:**

  ```typescript
  const address = MidnightBech32m.encode('undeployed', state.shielded.address).toString();
  wallet.transferTransaction([{ type: 'shielded', outputs: [{ receiverAddress: address, ... }] }]);
  ```

  **After:**

  ```typescript
  const address = await wallet.shielded.getAddress();
  wallet.transferTransaction([{ type: 'shielded', outputs: [{ receiverAddress: address, ... }] }]);
  ```

### Patch Changes

- 71b1324: Use intent spend time instead of pending spend ctime when processing TTLs during dust wallet reversion, and
  fix pending dust accumulation across multiple coin spends
- aa7ede2: ## Added
  - Implemented WebAssembly (WASM) proving provider as an alternative to server-based proving
  - Added `ProverClient.WasmConfig` interface for WASM prover configuration
  - Introduced Web Worker-based proof generation with message-based communication
  - Added comprehensive test coverage for both server and WASM proving services

  ## Changed
  - Updated proving interface to support custom key material providers
  - Migrated from Filecoin keys to Midnight-specific keys in Wasm prover

  ## Internal
  - Refactored test utilities to support multiple proving backends

- eb1e4c3: feat: add fee payment option to dust registration and handle deregistration
  - Filter coins already registered for dust generation from fee payment calculations
  - Add `registeredForDustGeneration` flag to `UtxoWithMeta` type
  - Add docs snippets for deregistration and redesignation flows

- dd004db: Add optional `keepAlive` config param to `SubscriptionClient.ServerConfig` and to `IndexerClientConnection`
  in all wallet packages. The value is forwarded to the underlying `graphql-ws` client and defaults to `15_000` ms when
  not provided.
- 0f29d01: - Moved `SyncProgress` from `wallet-sdk-shielded/v1` into `wallet-sdk-abstractions` so it can be shared
  across wallet implementations
  - Refactored `CoreWallet` in the dust wallet from a class to a plain object type + namespace, improving composability
  - Added `WalletError` type to the dust wallet for structured error handling
  - Added coin data to unshielded transaction history
  - Removed unused `wallet-sdk-hd` dependency from `wallet-sdk-unshielded-wallet`
  - Cleaned up `ProgressUpdate` type and `progress()` method from `TransactionHistoryCapability` in the shielded wallet
    (superseded by the shared `SyncProgress`)
- Updated dependencies [f52d01d]
- Updated dependencies [3843720]
- Updated dependencies [6c359b8]
- Updated dependencies [7ef6ff9]
- Updated dependencies [d3422bc]
- Updated dependencies [f52d01d]
- Updated dependencies [dd004db]
- Updated dependencies [0f29d01]
- Updated dependencies [55380e5]
- Updated dependencies [330867f]
  - @midnightntwrk/wallet-sdk-capabilities@3.1.0
  - @midnightntwrk/wallet-sdk-abstractions@2.0.0
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0
  - @midnightntwrk/wallet-sdk-address-format@3.0.1
  - @midnightntwrk/wallet-sdk-utilities@1.0.1
  - @midnightntwrk/wallet-sdk-runtime@1.0.1

## 2.0.0-rc.5

### Patch Changes

- dd004db: Add optional `keepAlive` config param to `SubscriptionClient.ServerConfig` and to `IndexerClientConnection`
  in all wallet packages. The value is forwarded to the underlying `graphql-ws` client and defaults to `15_000` ms when
  not provided.
- Updated dependencies [dd004db]
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0-rc.4

## 2.0.0-rc.4

### Patch Changes

- Updated dependencies [55380e5]
  - @midnightntwrk/wallet-sdk-utilities@1.0.1-rc.1
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0-rc.3
  - @midnightntwrk/wallet-sdk-runtime@1.0.1-rc.2

## 2.0.0-rc.3

### Patch Changes

- eb1e4c3: feat: add fee payment option to dust registration and handle deregistration
  - Filter coins already registered for dust generation from fee payment calculations
  - Add `registeredForDustGeneration` flag to `UtxoWithMeta` type
  - Add docs snippets for deregistration and redesignation flows

## 2.0.0-rc.2

### Major Changes

- d3422bc: - Extract proving into a standalone `ProvingService` in the `@midnightntwrk/wallet-sdk-capabilities` package,
  decoupling it from the shielded and dust wallet builders. The new service supports server (HTTP prover), WASM, and
  simulator proving modes via a unified configuration.
  - Remove `withProving` / `withProvingDefaults` and the `provingService` dependency from the V1 builders in both the
    shielded and dust wallet packages. Proving is no longer a wallet-level concern.
  - Integrate the `ProvingService` into `WalletFacade`, which now owns transaction proving and finalization. On proving
    failure the facade reverts the transaction across all three wallet types (shielded, unshielded, dust).

  ### Breaking changes
  - **`@midnightntwrk/wallet-sdk-shielded`**: Removed `finalizeTransaction` from `ShieldedWalletAPI`. Removed `Proving`
    export from `@midnightntwrk/wallet-sdk-shielded/v1`. Removed `provingService` from the V1 builder and
    `RunningV1Variant.Context`. Removed `withProving` / `withProvingDefaults` from `V1Builder`. `DefaultV1Configuration`
    no longer includes `DefaultProvingConfiguration`.
  - **`@midnightntwrk/wallet-sdk-dust-wallet`**: Removed `proveTransaction` from `DustWalletAPI`. Removed
    `provingService` from the V1 builder and `RunningV1Variant.Context`. Removed `withProving` / `withProvingDefaults`
    from `V1Builder`.
  - **`@midnightntwrk/wallet-sdk-facade`**: Removed the `UnboundTransaction` type export (now re-exported from
    `@midnightntwrk/wallet-sdk-capabilities/proving`). `WalletFacade` now requires a `ProvingService` and
    `DefaultConfiguration` includes `DefaultProvingConfiguration`.

### Patch Changes

- 0f29d01: - Moved `SyncProgress` from `wallet-sdk-shielded/v1` into `wallet-sdk-abstractions` so it can be shared
  across wallet implementations
  - Refactored `CoreWallet` in the dust wallet from a class to a plain object type + namespace, improving composability
  - Added `WalletError` type to the dust wallet for structured error handling
  - Added coin data to unshielded transaction history
  - Removed unused `wallet-sdk-hd` dependency from `wallet-sdk-unshielded-wallet`
  - Cleaned up `ProgressUpdate` type and `progress()` method from `TransactionHistoryCapability` in the shielded wallet
    (superseded by the shared `SyncProgress`)
- Updated dependencies [d3422bc]
- Updated dependencies [0f29d01]
  - @midnightntwrk/wallet-sdk-capabilities@3.1.0-rc.2
  - @midnightntwrk/wallet-sdk-abstractions@2.0.0-rc.1
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0-rc.2
  - @midnightntwrk/wallet-sdk-runtime@1.0.1-rc.1

## 2.0.0-rc.1

### Patch Changes

- Updated dependencies [3843720]
- Updated dependencies [330867f]
- Updated dependencies [fe57cc3]
  - @midnightntwrk/wallet-sdk-abstractions@2.0.0-rc.0
  - @midnightntwrk/wallet-sdk-utilities@1.0.1-rc.0
  - @midnightntwrk/wallet-sdk-shielded@2.0.0-rc.1
  - @midnightntwrk/wallet-sdk-prover-client@1.1.0-rc.1
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0-rc.1
  - @midnightntwrk/wallet-sdk-capabilities@3.1.0-rc.1

## 2.0.0-rc.0

### Major Changes

- f52d01d: - expose functions for reverting pending coins (booked for a pending transaction) from a provided transaction
  - extract submission into `@midnightntwrk/wallet-sdk-capabilities` package as a standalone service and integrate it
    into the `WalletFacade`
  - make `WalletFacade` revert transaction upon submission failure
  - change initialization of `WalletFacade` to a static async method `WalletFacade.init` taking a configuration object.
    This will allow non-breaking future initialization changes when e.g. new services are being integrated into the
    facade.
- 1409b6b: Standardize wallet APIs across shielded, unshielded, and dust wallets

  ### Breaking Changes

  **Dust Wallet:**
  - Rename `DustCoreWallet` to `CoreWallet` for consistency
  - Rename `walletBalance()` to `balance()` on `DustWalletState`
  - Rename `dustPublicKey` to `publicKey` and `dustAddress` to `address` on state objects
  - Rename `getDustPublicKey()` to `getPublicKey()` and `getDustAddress()` to `getAddress()` on `KeysCapability`
  - Add `getAddress(): Promise<DustAddress>` method to `DustWalletAPI`
  - Change `dustReceiverAddress` parameter type from `string` to `DustAddress` in transaction methods

  **Shielded Wallet:**
  - Rename `startWithShieldedSeed()` to `startWithSeed()` for consistency
  - Add `getAddress(): Promise<ShieldedAddress>` method
  - Change `receiverAddress` parameter type from `string` to `ShieldedAddress` in transfer methods
  - Transaction history getter now throws "not yet implemented" error

  **Facade:**
  - `TokenTransfer` interface now requires typed addresses (`ShieldedAddress` or `UnshieldedAddress`) instead of strings
  - Split `CombinedTokenTransfer` into `ShieldedTokenTransfer` and `UnshieldedTokenTransfer` types
  - Address encoding/decoding is now handled internally - consumers pass address objects directly

  ### Migration Guide

  **Before:**

  ```typescript
  const address = MidnightBech32m.encode('undeployed', state.shielded.address).toString();
  wallet.transferTransaction([{ type: 'shielded', outputs: [{ receiverAddress: address, ... }] }]);
  ```

  **After:**

  ```typescript
  const address = await wallet.shielded.getAddress();
  wallet.transferTransaction([{ type: 'shielded', outputs: [{ receiverAddress: address, ... }] }]);
  ```

### Patch Changes

- aa7ede2: ## Added
  - Implemented WebAssembly (WASM) proving provider as an alternative to server-based proving
  - Added `ProverClient.WasmConfig` interface for WASM prover configuration
  - Introduced Web Worker-based proof generation with message-based communication
  - Added comprehensive test coverage for both server and WASM proving services

  ## Changed
  - Updated proving interface to support custom key material providers
  - Migrated from Filecoin keys to Midnight-specific keys in Wasm prover

  ## Internal
  - Refactored test utilities to support multiple proving backends

- Updated dependencies [f52d01d]
- Updated dependencies [f52d01d]
- Updated dependencies [aa7ede2]
- Updated dependencies [1409b6b]
  - @midnightntwrk/wallet-sdk-shielded@2.0.0-rc.0
  - @midnightntwrk/wallet-sdk-capabilities@3.1.0-rc.0
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0-rc.0
  - @midnightntwrk/wallet-sdk-prover-client@1.1.0-rc.0

## 1.0.0

### Patch Changes

- 3f14055: chore: bump ledger to version 6.1.0-alpha.6
- fb55d52: Introduce more convenient API for Bech32m address encoding/decoding Remove network id from Dust wallet
  initialization methods (so they are read from the configuration) Introduce FacadeState and add a getter to check for
  sync status of whole facade wallet Introduce CompositeDerivation for HD wallet, so that it is possible to derive keys
  for multiple roles at once
- eec1ddb: feat: rewrite balancing recipes
- f7aac06: Update blockchain dependencies to latest versions:
  - Upgrade `@midnight-ntwrk/ledger-v7` from `7.0.0-rc.1` to `7.0.0` (stable release)
  - Update `indexer-standalone` Docker image from `3.0.0-alpha.25` to `3.0.0-rc.1`
  - Update `midnight-node` Docker image from `0.20.0-rc.1` to `0.20.0-rc.6`

- fb55d52: chore: remove wallet api dep from dust wallet
- aef8d4b: Performance improvement: Shielded and Dust wallet now send events in batches of 50 or after 10 seconds if
  total events has not reached 50
- 8b8d708: chore: update ledger to version 7.0.0-rc.1
- fb55d52: chore: initialize baseline release after introducing Changesets
- fb55d52: chore: force re-release after workspace failure
- aa3c5d7: Batch events for processing for better responsiveness and performance
- a768341: Use fallible section to enable usage of more than 1 pair of Night input/output
- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs
- fb55d52: chore: bump ledger to version 6.1.0-beta.5
- Updated dependencies [3f14055]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
- Updated dependencies [eec1ddb]
- Updated dependencies [94a39ef]
- Updated dependencies [f7aac06]
- Updated dependencies [a06ccf3]
- Updated dependencies [aef8d4b]
- Updated dependencies [8b8d708]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
- Updated dependencies [aa3c5d7]
- Updated dependencies [fb55d52]
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
- Updated dependencies [b9865cf]
  - @midnightntwrk/wallet-sdk-shielded@1.0.0
  - @midnightntwrk/wallet-sdk-address-format@3.0.0
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0
  - @midnightntwrk/wallet-sdk-node-client@1.0.0
  - @midnightntwrk/wallet-sdk-utilities@1.0.0
  - @midnightntwrk/wallet-sdk-hd@3.0.0
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0

## 1.0.0-beta.16

### Patch Changes

- f7aac06: Update blockchain dependencies to latest versions:
  - Upgrade `@midnight-ntwrk/ledger-v7` from `7.0.0-rc.1` to `7.0.0` (stable release)
  - Update `indexer-standalone` Docker image from `3.0.0-alpha.25` to `3.0.0-rc.1`
  - Update `midnight-node` Docker image from `0.20.0-rc.1` to `0.20.0-rc.6`

- Updated dependencies [f7aac06]
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.17
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.12
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.14
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.12
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.13
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.11
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.17

## 1.0.0-beta.15

### Patch Changes

- eec1ddb: feat: rewrite balancing recipes
- aa3c5d7: Batch events for processing for better responsiveness and performance
- a768341: Use fallible section to enable usage of more than 1 pair of Night input/output
- Updated dependencies [eec1ddb]
- Updated dependencies [aa3c5d7]
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.16

## 1.0.0-beta.14

### Patch Changes

- 8b8d708: chore: update ledger to version 7.0.0-rc.1
- Updated dependencies [8b8d708]
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.15
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.11
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.13
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.11
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.12
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.10
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.16

## 1.0.0-beta.13

### Patch Changes

- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs
- Updated dependencies [94a39ef]
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.15
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.14
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.10
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.12
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.10
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.11
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.9
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.10
  - @midnightntwrk/wallet-sdk-hd@3.0.0-beta.8

## 1.0.0-beta.12

### Patch Changes

- aef8d4b: Performance improvement: Shielded and Dust wallet now send events in batches of 50 or after 10 seconds if
  total events has not reached 50
- Updated dependencies [aef8d4b]
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.13
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.11
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.8
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.14

## 1.0.0-beta.11

### Patch Changes

- Updated dependencies [b9865cf]
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.13
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.12

## 1.0.0-beta.10

### Patch Changes

- 3f14055: chore: bump ledger to version 6.1.0-alpha.6
- Updated dependencies [3f14055]
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.11
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.9
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.10
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.9
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.10

## 1.0.0-beta.9

### Patch Changes

- fb55d52: Introduce more convenient API for Bech32m address encoding/decoding Remove network id from Dust wallet
  initialization methods (so they are read from the configuration) Introduce FacadeState and add a getter to check for
  sync status of whole facade wallet Introduce CompositeDerivation for HD wallet, so that it is possible to derive keys
  for multiple roles at once
- Updated dependencies [fb55d52]
- Updated dependencies [a06ccf3]
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.8
  - @midnightntwrk/wallet-sdk-hd@3.0.0-beta.7
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.9
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.8
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.10
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.12
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.9

## 1.0.0-beta.8

### Patch Changes

- f967d17: chore: remove wallet api dep from dust wallet
- 1db4280: chore: bump ledger to version 6.1.0-beta.5
- Updated dependencies [976628a]
- Updated dependencies [0838f04]
- Updated dependencies [f6618f1]
- Updated dependencies [1db4280]
- Updated dependencies [646c8df]
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.8
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.7
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.9
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.7
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.11
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.8
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.7
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.9

## 1.0.0-beta.7

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure
- Updated dependencies [2a0d132]
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.6
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.10
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.7
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.7
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.6
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.8
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.6
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.8
  - @midnightntwrk/wallet-sdk-hd@3.0.0-beta.6

## 1.0.0-beta.6

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
- Updated dependencies [ae22baf]
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.6
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.5
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.5
  - @midnightntwrk/wallet-sdk-hd@3.0.0-beta.5
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.9
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.7
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.6
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.5
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.7
