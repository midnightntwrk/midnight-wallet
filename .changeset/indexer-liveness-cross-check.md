---
'@midnightntwrk/wallet-sdk': major
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-node-client': major
'@midnightntwrk/wallet-sdk-abstractions': major
'@midnightntwrk/wallet-sdk-capabilities': major
---

feat(unshielded-wallet): cross-check the indexer's reported tip against the node's finalized head

The unshielded wallet no longer takes the indexer's word that it is synced. It polls a node's finalized head (every 30
seconds by default) and checks that indexer and node name the same block at the newest height both have passed; genesis
is the height-zero case. The node is `nodeClientConnection`, falling back to `relayURL`; a wallet naming neither is not
checked. Tune with `livenessConfiguration` and `livenessPollInterval`.

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
`isCompleteWithin()`, `FacadeState.isSynced` and `waitForSyncedState()` now also need a first liveness verdict that does
not block. On by default for every wallet with a `relayURL`. Against a stale indexer `waitForSyncedState()` neither
rejects nor times out; race it against your own deadline and read `progress.indexerLiveness` (see the `indexer-liveness` docs
snippet). `SyncProgressData` gains a required `indexerLiveness` field, defaulted by `createSyncProgress()`. Sync types
are parameterised on `SyncUpdate`, a superset of `WalletSyncUpdate`.

BREAKING CHANGE (`wallet-sdk-unshielded-wallet`): `SyncService.livenessUpdates` is required. A custom source with
nothing to check emits one `IndexerLiveness.Skipped({ reason: 'no-liveness-feed' })` and ends. `SimulatorSyncUpdate`
now includes a liveness update.

BREAKING CHANGE (`wallet-sdk-node-client`): `NodeClient.Service` gains required `getFinalizedBlock()`,
`getGenesisHash()` and `getBlockHashAt(height)`; `getBlockHashAt` returns `Option.none` for a height with no block.
Only implementers are affected.

BREAKING CHANGE (`wallet-sdk-abstractions`): `IndexerLiveness.WrongNetwork` carries
`{ height, indexerBlockHash, nodeBlockHash }` (hashes are `Option<string>`) instead of two genesis hashes.
`sameGenesis` is renamed `sameBlockHash`; `evaluateTips` is added beside `evaluate`.

BREAKING CHANGE (`wallet-sdk-capabilities`): `LivenessReads` replaces `indexerHeight` and `finalizedHeight` with
`indexerTip` and `finalizedBlock` (height and hash together), and adds `indexerBlockHashAt(height)` and
`nodeBlockHashAt(height)`. Only callers supplying their own reads are affected.
