# @midnightntwrk/wallet-sdk

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

- 1eaad77: Pin internal `@midnightntwrk/wallet-sdk-*` dependencies to exact versions instead of caret ranges. A caret
  range on a prerelease base (e.g. `^5.0.0-beta.0`) satisfies canary snapshots published on the same `major.minor.patch`
  (`5.0.0-canary.*`), and since `canary` sorts above `beta`/`alpha`, installing a prerelease pulled canary builds of the
  sibling packages. Exact pins make published releases resolve to a single coherent set regardless of what snapshots
  exist on the registry.
- Updated dependencies [b545c3b]
- Updated dependencies [f51ee1e]
- Updated dependencies [4875043]
- Updated dependencies [44bbcae]
- Updated dependencies [ef16433]
- Updated dependencies [aae483d]
- Updated dependencies [44bbcae]
- Updated dependencies [ead236e]
- Updated dependencies [efd33ab]
- Updated dependencies [98dff89]
- Updated dependencies [e89ab0b]
- Updated dependencies [3b778cb]
- Updated dependencies [4628d98]
- Updated dependencies [38e42a7]
- Updated dependencies [1eaad77]
- Updated dependencies [ef16433]
  - @midnightntwrk/wallet-sdk-indexer-client@2.0.0
  - @midnightntwrk/wallet-sdk-node-client@2.0.0
  - @midnightntwrk/wallet-sdk-shielded@3.1.0
  - @midnightntwrk/wallet-sdk-dust-wallet@5.0.0
  - @midnightntwrk/wallet-sdk-facade@5.0.0
  - @midnightntwrk/wallet-sdk-unshielded-wallet@4.0.0
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0
  - @midnightntwrk/wallet-sdk-prover-client@1.2.4
  - @midnightntwrk/wallet-sdk-runtime@1.0.6

## 1.2.0

### Minor Changes

- a4e049d: Republish the barrel package to track the latest sibling versions shipped in this release (facade,
  dust-wallet, shielded, indexer-client, prover-client, node-client, runtime, hd, and the new testkit). No API changes
  to the barrel itself — the version bump keeps the `@midnightntwrk/wallet-sdk` release line aligned with the underlying
  packages it re-exports.

### Patch Changes

- Updated dependencies [dff5706]
- Updated dependencies [7111b55]
- Updated dependencies [54a9c4d]
- Updated dependencies [417d042]
- Updated dependencies [e0097fc]
- Updated dependencies [81ae094]
- Updated dependencies [0b41e11]
  - @midnightntwrk/wallet-sdk-dust-wallet@4.2.0
  - @midnightntwrk/wallet-sdk-facade@4.1.0
  - @midnightntwrk/wallet-sdk-prover-client@1.2.3
  - @midnightntwrk/wallet-sdk-shielded@3.0.2
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.3
  - @midnightntwrk/wallet-sdk-hd@3.0.3
  - @midnightntwrk/wallet-sdk-node-client@1.1.3
  - @midnightntwrk/wallet-sdk-runtime@1.0.5

## 1.1.0

### Minor Changes

- db8db9c: Barrel-export every non-ignored wallet-sdk package. Adds `indexer-client`, `node-client`, `prover-client`,
  `runtime`, and `utilities` as new subpath entry points (each matching their package folder name), and surfaces every
  nested subpath those packages already expose (`/v1`, `/effect`, `/abstractions`, `/balancer`, `/pendingTransactions`,
  `/proving`, `/simulation`, `/submission`, `/networking`, `/types`, `/testing`). The main entry point now also
  re-exports `prover-client` and `utilities` flat, plus namespaced `Capabilities`, `IndexerClient`, `NodeClient`, and
  `Runtime` (namespaced to avoid name collisions with other packages). Legacy `/proving` and `/testing` aliases remain
  for backwards compatibility.

### Patch Changes

- Updated dependencies [0fd0062]
- Updated dependencies [6e187fe]
- Updated dependencies [8004393]
- Updated dependencies [7452e96]
- Updated dependencies [25f58b4]
  - @midnightntwrk/wallet-sdk-dust-wallet@4.1.0
  - @midnightntwrk/wallet-sdk-unshielded-wallet@3.1.0
  - @midnightntwrk/wallet-sdk-utilities@1.2.0
  - @midnightntwrk/wallet-sdk-facade@4.0.1
  - @midnightntwrk/wallet-sdk-address-format@3.1.2
  - @midnightntwrk/wallet-sdk-capabilities@3.3.1
  - @midnightntwrk/wallet-sdk-node-client@1.1.2
  - @midnightntwrk/wallet-sdk-prover-client@1.2.2
  - @midnightntwrk/wallet-sdk-shielded@3.0.1
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.2
  - @midnightntwrk/wallet-sdk-runtime@1.0.4

## 1.0.0

### Major Changes

- 471583c: First release of wallet-sdk barrel package

### Minor Changes

- 93492c0: Add a proper barrel package to the wallet sdk

### Patch Changes

- Updated dependencies [e57a94b]
- Updated dependencies [c1ae369]
- Updated dependencies [55715af]
- Updated dependencies [eba8e08]
- Updated dependencies [6e67871]
- Updated dependencies [3763803]
- Updated dependencies [8383f7b]
- Updated dependencies [1f794fa]
- Updated dependencies [0db3290]
- Updated dependencies [0529e6a]
- Updated dependencies [7f82432]
- Updated dependencies [aaa0bf1]
  - @midnightntwrk/wallet-sdk-capabilities@3.3.0
  - @midnightntwrk/wallet-sdk-facade@4.0.0
  - @midnightntwrk/wallet-sdk-dust-wallet@4.0.0
  - @midnightntwrk/wallet-sdk-shielded@3.0.0
  - @midnightntwrk/wallet-sdk-unshielded-wallet@3.0.0
  - @midnightntwrk/wallet-sdk-abstractions@2.1.0
  - @midnightntwrk/wallet-sdk-address-format@3.1.1
  - @midnightntwrk/wallet-sdk-utilities@1.1.1
  - @midnightntwrk/wallet-sdk-hd@3.0.2
