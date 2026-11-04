---
'@midnightntwrk/wallet-sdk-shielded': major
---

Breaking changes since 3.x

- **Two ledger versions.** `ShieldedWallet(configuration)` runs a ledger-v8 variant (V1) below `forks.v9` and a
  ledger-v9 variant (V2) from it, and carries the wallet's coins across when the chain crosses. `forks` is required, and
  `DefaultShieldedConfiguration` is declared by the package rather than aliased to a variant's.
- **Starting.** `ShieldedWallet(configuration).startWithSeed(seed)` returns a `Promise`, and `startWithSecretKeys` is
  replaced by `startWithKeys({ v8, v9 })`, also asynchronous. A fresh start asks the chain which protocol version its
  first block was produced under (`chainVersionProbe`, by default the indexer) and starts on the matching variant; if
  the probe fails, it starts on V1. An instance's `start` takes `ShieldedKeysByEpoch`, `{ v8, v9 }` (each ledger
  version's `ZswapSecretKeys`), whichever variant it resumes on, and keeps them until `stop()`.
- **Transacting.** `balanceTransaction(tx, ttl?)`, `transferTransaction(outputs, ttl?)` and
  `initSwap(inputs, outputs, ttl?)` no longer take secret keys, and transactions go in and out as `WalletTransaction`
  handles stamped with the protocol version they were built for. A handle for the other ledger version is refused by the
  methods that build and balance, and ignored by `revertTransaction` and `revertFailedSegments`. Transacting after
  `stop()`, which drops the keys, fails with `MissingStartAuxError`. `balanceTransaction` returns a
  `ShieldedBalancingResult`.
- **API types.** `ShieldedWalletAPI<TKeys = never, TSerialized>` and `ShieldedWalletState` drop the transaction type
  parameter, and a wallet typed as a bare `ShieldedWalletAPI` cannot be started. `ShieldedWalletAPI` requires
  `revertFailedSegments`. `ShieldedWalletState.state` is sealed: read it with `coreStateOf` from `./v1` or `./v2`. The
  state loses `capabilities`, `services` and `mapState` (use `fromVariant`), and its constructor takes
  `(protocolVersion, state, projections)` in place of `(state, capabilities, services)`. `ShieldedWalletCapabilities`,
  `ShieldedWalletServices` and `UnboundTransaction` are removed: use `ShieldedWalletTypes`, and the capabilities
  package's `V8UnboundTransaction` or `V9UnboundTransaction`.
- **`CustomShieldedWallet`** composes one ledger-v9 variant, from a V2 builder, instead of a ledger-v8 one. Its
  synchronous starts remain, its instance `start` takes `{ v9: keys }`, and it cannot cross a fork.
- **Transaction history.** `txHistoryStorage` is a `ShieldedHistoryStorage`, and a `ShieldedTransactionHistoryEntry` is
  the common lifecycle entry with an optional `shielded` section. A custom `TransactionHistoryService` returns
  `TransactionDetails` with the `block` (`hash`, `height`, `timestamp`) and the transaction's `identifiers` in place of
  `timestamp`, and may fail with `BlocklessFinalizedEntryError`.
- **Custom sync and variants.** Sync updates are a tagged union with a `VersionSignal` member, and
  `WalletSyncUpdate.create` takes the instant the source stamped the update as a third argument. `EventsSyncUpdate`
  carries the event's `raw` hex, decoded with `readEvent`. `applyUpdate` receives the protocol-version range its variant
  owns and must leave updates beyond it unapplied. `TransactingCapability` requires `revertFailedSegments`. A custom
  variant (`V1Variant`, `V2Variant`) must supply `startAux`, the `StartMaterial.StartAuxCapability` its builder sets
  with `withStartAux(Defaults)`, and takes an optional fifth type parameter for the previous variant's state. The `./v1`
  `Simulator` is the capabilities `V8` simulator, without `getBlockEventsSince`.
- **Errors.** The `WalletError` union of `./v1` and `./v2` gains `SnapshotRestoreError` and `OutOfOrderSyncUpdateError`,
  so an exhaustive match over it must handle them.
- **Snapshots.** An unreadable snapshot is refused with `SnapshotRestoreError` instead of `Wallet.Other`, and `restore`
  throws that tagged error.
- **Dependencies.** Depends on `@midnightntwrk/ledger-v9` `1.0.0-rc.7` beside `@midnight-ntwrk/ledger-v8`.
