---
'@midnightntwrk/wallet-sdk-dust-wallet': major
---

Breaking changes since 4.x

- **Two ledger versions.** `DustWallet(configuration)` runs a ledger-v8 variant (V1) below `forks.v9` and a ledger-v9
  variant (V2) from it. At the crossing the Dust state starts empty and is rebuilt from the chain. `forks` is required,
  and `DefaultDustConfiguration` is declared by the package.
- **Starting.** `DustWallet(configuration).startWithSeed(seed, rates?)` returns a `Promise`, and `startWithSecretKey` is
  replaced by `startWithKeys({ v8, v9 }, rates?)`. Generation rates are plain `DustGenerationRates` rather than ledger
  `DustParameters`, though either ledger version's `DustParameters` is still accepted; left out, they are the configured
  `dustParameters`, which default to ledger-v9's initial ones. A fresh start asks the chain the protocol version of its
  first block (`chainVersionProbe`, by default the indexer) to pick the variant; if the probe fails, it starts on V1. An
  instance's `start` takes `DustKeysByEpoch`, `{ v8, v9 }`, whichever variant it resumes on, and keeps them until
  `stop()`.
- **Transacting.** `estimateFee` and `balanceTransactions` no longer take a secret key; after `stop()` they fail with
  `MissingStartAuxError`. `balanceTransactions` resolves `{ transaction, blockData }`, where `blockData` holds the
  ledger parameters the fee was priced with (typed `unknown` on `DustWalletAPI`; read them with the capabilities
  `withLedgerParameters`). Transactions are `WalletTransaction` handles; a handle for the other ledger version is
  refused with `ProtocolVersionMismatchError`, except by `revertTransaction`, which ignores it. Signatures, and the
  `nightVerifyingKey` that `createDustGenerationTransaction` and `attachDustRegistration` take, use the SDK's `Signing`
  types, and an ECDSA one is refused below `forks.v9`.
- **API types.** `DustWalletAPI<TKeys = never, TSerialized>`: `start(keys)` takes the wallet's own keys type, and the
  API requires `stepSync` and `ensureFeeCoverage`. `DustWalletState.state` is sealed: read it with `coreStateOf` from
  `./v1` or `./v2`. The state loses `capabilities`, `services` and `mapState` (use `fromVariant`), and its constructor
  takes `(protocolVersion, state, projections)` in place of `(state, capabilities, services)`. `DustWalletCapabilities`
  and `DustWalletServices` are removed, and the shared types live in `DustWalletTypes`.
- **Subpaths.** `./v1` exports the ledger-v8 variant and no longer the wallet API: import `DustWallet`,
  `CustomDustWallet`, `DustWalletAPI`, `DustWalletState` and `DefaultDustConfiguration` from the package root. Its
  `Simulator` is the capabilities `V8` simulator.
- **`CustomDustWallet`** composes one ledger-v9 variant, from a V2 builder with ledger-v9 `DustParameters`, instead of a
  ledger-v8 one; its starts stay synchronous, its instance `start` takes `{ v9: key }`, and it cannot cross a fork.
- **Custom sync and core state.** A `SyncService` declares how background synchronization repeats its `updates`, as a
  required `backgroundRepeat`: `BackgroundRepeat.Once()` for a long-lived subscription, or
  `BackgroundRepeat.WithDelay({ delay })`. Sync updates are tagged `Events` or `VersionSignal`, `applyUpdate` receives
  the protocol-version range its variant owns, and `BlockData` requires `protocolVersion`. A custom variant
  (`V1Variant`, `V2Variant`) must supply `startAux`, the `StartMaterial.StartAuxCapability` its builder sets with
  `withStartAux(Defaults)`, and takes an optional fifth type parameter for the previous variant's state.
  `CoreWallet.pendingDust` holds `PendingDust` entries (`{ coin, nullifier, declaredTime }`), and `DustWithNullifier` is
  removed. `CoreWallet` records which sync moved its position as a required `syncKind` (`'events' | 'projections'`),
  which `CoreWallet.restore` takes as its last argument.
- **Errors.** The `WalletError` union of `./v1` and `./v2` gains `SnapshotRestoreError`, `OutOfOrderSyncUpdateError` and
  `InsufficientDustForFeeError`, and that of `./v2` also `SnapshotSyncMismatchError`, so an exhaustive match over it must
  handle them.
- **Snapshots.** Snapshots are format `v2`, recording the variant that wrote them, the Dust still pending, and which
  sync saved their position (`syncKind`); 4.x snapshots are read and upgraded. Once this release has saved a wallet,
  going back to 4.x means restoring it from its seed. An unreadable snapshot is refused with `SnapshotRestoreError`
  instead of `Wallet.Other`, and `restore` throws that tagged error.
- **Transaction history.** `txHistoryStorage` is a `DustHistoryStorage`, and a `DustTransactionHistoryEntry` is the
  common lifecycle entry with an optional `dust` section. A custom `TransactionHistoryService` returns
  `TransactionDetails` with the `block` (`hash`, `height`, `timestamp`), the transaction's `identifiers` and its `fees`
  in place of `timestamp`, and may fail with `BlocklessFinalizedEntryError`.
- **Dependencies.** Depends on `@midnightntwrk/ledger-v9` `1.0.0-rc.7` beside `@midnight-ntwrk/ledger-v8`.
