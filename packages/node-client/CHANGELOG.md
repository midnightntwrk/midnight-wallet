# @midnightntwrk/wallet-sdk-node-client

## 2.0.0

### Major Changes

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

### Patch Changes

- f51ee1e: chore(deps): combined dependency updates (2026-10-01)

  Adapt the `testing` tar-extract pipeline to the type definitions bundled with `tar-stream` 3.2.1 and drop the
  superseded `@types/tar-stream`.

- 38e42a7: fix(node-client): await the socket close in `make()`, and reference count the shared connection

  `WsProvider.disconnect()` is fire-and-forget: it dispatches the close frame and returns while the socket is still
  `CLOSING`. `isConnected` only clears once `#onSocketClose` fires, so `PolkadotNodeClient.make()` returned an api whose
  `isConnected` was stale-`true`. `ensureConnection()` then treated the connection as live, skipped the reconnect, and
  sent on a dying socket -- the close handshake completed milliseconds later and flushed `submitAndWatchExtrinsic` with
  a disconnect error, so the transaction never reached the network. Locally the close-ack lands fast enough to hide
  this; against a remote node it does not. Fixes #327.

  Separately, each operation attached an unconditional `api.disconnect()` finalizer to the shared api, so one operation
  completing could close the transport another was still using. Connection holds are now reference counted and the
  socket closes when the last operation finishes; single-operation behaviour is unchanged.

- 1eaad77: Pin internal `@midnightntwrk/wallet-sdk-*` dependencies to exact versions instead of caret ranges. A caret
  range on a prerelease base (e.g. `^5.0.0-beta.0`) satisfies canary snapshots published on the same `major.minor.patch`
  (`5.0.0-canary.*`), and since `canary` sorts above `beta`/`alpha`, installing a prerelease pulled canary builds of the
  sibling packages. Exact pins make published releases resolve to a single coherent set regardless of what snapshots
  exist on the registry.
- Updated dependencies [e89ab0b]
- Updated dependencies [3b778cb]
- Updated dependencies [1eaad77]
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0
  - @midnightntwrk/wallet-sdk-prover-client@1.2.4

## 1.1.3

### Patch Changes

- 81ae094: Declare `@midnight-ntwrk/ledger-v8` and `@midnightntwrk/wallet-sdk-prover-client` as optional peer
  dependencies. They are used at runtime by the `./testing` export, so consumers of that export need them installed.
- Updated dependencies [7111b55]
  - @midnightntwrk/wallet-sdk-prover-client@1.2.3

## 1.1.2

### Patch Changes

- 7452e96: Bump `@midnight-ntwrk/ledger-v8` from `^8.0.3` to `^8.1.0`. Internal balancing flows in `dust-wallet`,
  `unshielded-wallet`, and `shielded-wallet` are refactored to use the new ledger 8.1.0 builder API
  (`Transaction.addIntent`, `Transaction.addZswapOffer`) instead of post-construction field mutation on
  `Transaction.fromParts(...)`. No public API changes; consumers must resolve `@midnight-ntwrk/ledger-v8` to `>=8.1.0`.
- 25f58b4: Widen ranges for internal `@midnightntwrk/wallet-sdk-*` dependencies from exact versions to caret ranges so
  consumers can dedupe shared sibling packages into a single installed copy.
- Updated dependencies [6e187fe]
- Updated dependencies [7452e96]
  - @midnightntwrk/wallet-sdk-utilities@1.2.0

## 1.1.1

### Patch Changes

- 0db3290: chore: bump ledger version to 8.0.3
- 7f82432: Introduce a shared transaction history storage layer with support for wallet-specific augmentation.
  Reimplement shielded wallet transaction history and refactor unshielded wallet transaction history to use the new
  shared storage.
- Updated dependencies [c1ae369]
- Updated dependencies [0db3290]
- Updated dependencies [7f82432]
  - @midnightntwrk/wallet-sdk-abstractions@2.1.0
  - @midnightntwrk/wallet-sdk-utilities@1.1.1

## 1.1.0

### Minor Changes

- aa7b1f4: chore: update ledger to v8

### Patch Changes

- 1fa7e03: Clarify the error message returned for invalid transactions.
- Updated dependencies [ea55591]
- Updated dependencies [aa7b1f4]
  - @midnightntwrk/wallet-sdk-utilities@1.1.0

## 1.1.0-rc.0

### Minor Changes

- aa7b1f4: chore: update ledger to v8

### Patch Changes

- Updated dependencies [ea55591]
- Updated dependencies [aa7b1f4]
  - @midnightntwrk/wallet-sdk-utilities@1.1.0-rc.0

## 1.0.1

### Patch Changes

- 7ef6ff9: fix: bump package versions
- cef03a5: Connect WebSocket on-demand and disconnect after each operation to prevent @polkadot/api health-check timers
  from keeping service workers alive
- Updated dependencies [3843720]
- Updated dependencies [0f29d01]
- Updated dependencies [55380e5]
- Updated dependencies [330867f]
  - @midnightntwrk/wallet-sdk-abstractions@2.0.0
  - @midnightntwrk/wallet-sdk-utilities@1.0.1

## 1.0.0

### Patch Changes

- 3f14055: chore: bump ledger to version 6.1.0-alpha.6
- f7aac06: Update blockchain dependencies to latest versions:
  - Upgrade `@midnight-ntwrk/ledger-v7` from `7.0.0-rc.1` to `7.0.0` (stable release)
  - Update `indexer-standalone` Docker image from `3.0.0-alpha.25` to `3.0.0-rc.1`
  - Update `midnight-node` Docker image from `0.20.0-rc.1` to `0.20.0-rc.6`

- 8b8d708: chore: update ledger to version 7.0.0-rc.1
- fb55d52: chore: initialize baseline release after introducing Changesets
- fb55d52: chore: force re-release after workspace failure
- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs
- fb55d52: chore: bump ledger to version 6.1.0-beta.5

## 1.0.0-beta.13

### Patch Changes

- f7aac06: Update blockchain dependencies to latest versions:
  - Upgrade `@midnight-ntwrk/ledger-v7` from `7.0.0-rc.1` to `7.0.0` (stable release)
  - Update `indexer-standalone` Docker image from `3.0.0-alpha.25` to `3.0.0-rc.1`
  - Update `midnight-node` Docker image from `0.20.0-rc.1` to `0.20.0-rc.6`

## 1.0.0-beta.12

### Patch Changes

- 8b8d708: chore: update ledger to version 7.0.0-rc.1

## 1.0.0-beta.11

### Patch Changes

- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs

## 1.0.0-beta.10

### Patch Changes

- 3f14055: chore: bump ledger to version 6.1.0-alpha.6

## 1.0.0-beta.9

### Patch Changes

- 1db4280: chore: bump ledger to version 6.1.0-beta.5

## 1.0.0-beta.8

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure

## 1.0.0-beta.7

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
