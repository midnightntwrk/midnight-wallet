# @midnightntwrk/wallet-sdk-abstractions

## 3.0.0

### Major Changes

- e89ab0b: Track transaction lifecycle in transaction history. Submitted transactions are now recorded as pending,
  transition to finalized once confirmed by the indexer, and to rejected if they are reverted — giving a single,
  consistent view of in-flight and settled transactions.

### Minor Changes

- 3b778cb: feat(unshielded-wallet)!: cross-check the indexer's reported tip against the node's finalized head

  The unshielded wallet no longer takes the indexer's word that it is synced. It polls a node's finalized head (every 30
  seconds by default) and checks that indexer and node name the same block at the newest height both have passed;
  genesis is the height-zero case. The node is `nodeClientConnection`, falling back to `relayURL`; a wallet naming
  neither is not checked. Tune with `livenessConfiguration` and `livenessPollInterval`.

  The result is an `IndexerLiveness` verdict on `SyncProgress`. `Behind`, `Unknown` and `WrongNetwork` block completion;
  `InSync`, `Ahead`, `Unavailable` and `Skipped` do not. A failed poll keeps a `Behind` or `WrongNetwork` verdict, so a
  node outage cannot release a caller waiting on a stale indexer. A verdict is republished only when it changes
  (`IndexerLiveness.equivalent`), not on every poll. This detects staleness, not withholding. The shielded and dust
  wallets are not gated (#743).

  ### Fixes
  - Unshielded `isConnected` clears when the indexer subscription drops or completes, and the subscription is rebuilt in
    both cases; it previously latched `true` (#743).
  - `api.rpc` calls (`getGenesis()`) work right after node client creation.
  - Node connection failures are typed errors, no longer defects.
  - A finite `reconnectionTimeout` also bounds the initial connection and retries within it, so a restarting node
    connects on a later attempt instead of failing the build.
  - The unshielded sync retry backoff is really capped at two minutes; it previously kept doubling until it stopped
    retrying (#742).

  BREAKING CHANGE (`wallet-sdk`, `wallet-sdk-facade`, `wallet-sdk-unshielded-wallet`): `isStrictlyComplete()`,
  `isCompleteWithin()`, `FacadeState.isSynced` and `waitForSyncedState()` now also need a first liveness verdict that
  does not block. On by default for every wallet with a `relayURL`. Against a stale indexer `waitForSyncedState()`
  neither rejects nor times out; race it against your own deadline and read `progress.indexerLiveness` (see the
  `indexer-liveness` docs snippet). `SyncProgressData` gains a required `indexerLiveness` field, defaulted by
  `createSyncProgress()`. Sync types are parameterised on `SyncUpdate`, a superset of `WalletSyncUpdate`.

  BREAKING CHANGE (`wallet-sdk-unshielded-wallet`): `SyncService.livenessUpdates` is required. A custom source with
  nothing to check emits one `IndexerLiveness.Skipped({ reason: 'no-liveness-feed' })` and ends. `SimulatorSyncUpdate`
  now includes a liveness update.

  BREAKING CHANGE (`wallet-sdk-node-client`): `NodeClient.Service` gains required `getFinalizedBlock()`,
  `getGenesisHash()` and `getBlockHashAt(height)`; `getBlockHashAt` returns `Option.none` for a height with no block.
  Only implementers are affected.

  `wallet-sdk-abstractions` adds `IndexerLiveness`: the verdict type, `evaluate` and `evaluateTips` for comparing an
  indexer against a node, `blocksSyncCompletion`, `equivalent` and `sameBlockHash`.

  `wallet-sdk-capabilities` adds the liveness check: `LivenessServiceImpl`, `LivenessReads` (`indexerTip`,
  `finalizedBlock`, `indexerBlockHashAt`, `nodeBlockHashAt`), `makeDefaultLivenessReads`,
  `DEFAULT_LIVENESS_CONFIGURATION` and `DEFAULT_POLL_INTERVAL`.

## 2.1.0

### Minor Changes

- 7f82432: Introduce a shared transaction history storage layer with support for wallet-specific augmentation.
  Reimplement shielded wallet transaction history and refactor unshielded wallet transaction history to use the new
  shared storage.

### Patch Changes

- c1ae369: Fix transaction history race condition by consolidating merge logic in the facade and delegating it to
  storage at construction time.

## 2.0.0

### Major Changes

- 3843720: Replace `SerializedUnprovenTransaction` with `SerializedTransaction`, a simplified type for holding
  serialized transaction bytes

### Patch Changes

- 0f29d01: - Moved `SyncProgress` from `wallet-sdk-shielded/v1` into `wallet-sdk-abstractions` so it can be shared
  across wallet implementations
  - Refactored `CoreWallet` in the dust wallet from a class to a plain object type + namespace, improving composability
  - Added `WalletError` type to the dust wallet for structured error handling
  - Added coin data to unshielded transaction history
  - Removed unused `wallet-sdk-hd` dependency from `wallet-sdk-unshielded-wallet`
  - Cleaned up `ProgressUpdate` type and `progress()` method from `TransactionHistoryCapability` in the shielded wallet
    (superseded by the shared `SyncProgress`)

## 2.0.0-rc.1

### Patch Changes

- 0f29d01: - Moved `SyncProgress` from `wallet-sdk-shielded/v1` into `wallet-sdk-abstractions` so it can be shared
  across wallet implementations
  - Refactored `CoreWallet` in the dust wallet from a class to a plain object type + namespace, improving composability
  - Added `WalletError` type to the dust wallet for structured error handling
  - Added coin data to unshielded transaction history
  - Removed unused `wallet-sdk-hd` dependency from `wallet-sdk-unshielded-wallet`
  - Cleaned up `ProgressUpdate` type and `progress()` method from `TransactionHistoryCapability` in the shielded wallet
    (superseded by the shared `SyncProgress`)

## 2.0.0-rc.0

### Major Changes

- 3843720: Replace `SerializedUnprovenTransaction` with `SerializedTransaction`, a simplified type for holding
  serialized transaction bytes

## 1.0.0

### Minor Changes

- fb55d52: chore: add network id for qanet

### Patch Changes

- a06ccf3: Adds missing main property in the package.json file for the abstractions package
- fb55d52: chore: initialize baseline release after introducing Changesets
- fb55d52: chore: force re-release after workspace failure
- bcef7d8: Allow TX creation with no own outputs
- fb55d52: chore: bump ledger to version 6.1.0-beta.5

## 1.0.0-beta.10

### Patch Changes

- bcef7d8: Allow TX creation with no own outputs

## 1.0.0-beta.9

### Patch Changes

- a06ccf3: Adds missing main property in the package.json file for the abstractions package

## 1.0.0-beta.8

### Minor Changes

- 646c8df: chore: add network id for qanet

### Patch Changes

- 1db4280: chore: bump ledger to version 6.1.0-beta.5

## 1.0.0-beta.7

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure

## 1.0.0-beta.6

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
