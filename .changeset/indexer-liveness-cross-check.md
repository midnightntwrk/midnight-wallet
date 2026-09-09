---
'@midnightntwrk/wallet-sdk': major
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-node-client': major
'@midnightntwrk/wallet-sdk-abstractions': minor
'@midnightntwrk/wallet-sdk-capabilities': minor
---

feat(unshielded-wallet): cross-check the indexer's reported tip against the node's finalized head

The wallet now verifies "synced" against the chain instead of the indexer's self-report: it polls a node's finalized
head (every 30 seconds by default) and, once, checks that both endpoints name the same genesis block. The node is
`nodeClientConnection` on the configuration, falling back to `relayURL`; a wallet naming neither is not checked. The
result is an `IndexerLiveness` verdict on `SyncProgress`: `Behind`, `Unknown` and `WrongNetwork` block completion; the
other four (`InSync`, `Ahead`, `Unavailable`, `Skipped`) do not. A poll that fails after a `Behind` or `WrongNetwork`
verdict leaves that verdict in place — an unreachable endpoint disproves nothing — so a node outage cannot release a
caller waiting on a stale indexer. A custom sync service supplied through `withSync` that exposes no `livenessUpdates`
is reported as `Skipped` (`no-liveness-feed`), so it can still reach "synced". Tune with `livenessConfiguration` and
`livenessPollInterval`. This detects staleness, not withholding.

### Fixes

- `isConnected` on the sync progress clears when the indexer subscription drops or is completed by the indexer, and the
  subscription is rebuilt in both cases; it previously latched `true`, and a completed subscription was never rebuilt.
- `api.rpc` calls (`getGenesis()`) work after client creation; they previously failed as disconnected.
- Node connection failures are typed errors reachable by `catchTag`/`catchAll`, no longer defects.
- A finite `reconnectionTimeout` also bounds the initial connection — the handshake and the close that follows it — and
  the liveness poll's own timeout is hard even when a read is stuck in that build; no timeout (submission) stays
  unbounded.
- The sync streams' retry backoff is genuinely capped at two minutes. The cap was applied to the schedule's output
  rather than its interval, so retries kept doubling — half an hour apart by the twelfth — until the timer overflowed
  and the stream stopped retrying.

BREAKING CHANGE (`wallet-sdk`, `wallet-sdk-facade`, `wallet-sdk-unshielded-wallet`): `isStrictlyComplete()`,
`isCompleteWithin()`, `FacadeState.isSynced` and `waitForSyncedState()` now also require the indexer not to trail the
finalized head, a matching genesis, and a first verdict (`Skipped` — no node, or a simulation — does not block). On by
default for every wallet with a `relayURL`. Against a stale indexer, `waitForSyncedState()` waits — it neither rejects
nor times out; race it against a deadline of your own and read `progress.indexerLiveness` and `progress.isConnected`
(the `indexer-liveness` docs snippet shows the pattern). `SyncProgressData` gains a required `indexerLiveness` field,
defaulted by `createSyncProgress()`; sync types are parameterised on `SyncUpdate`, a superset of `WalletSyncUpdate`.

BREAKING CHANGE (`wallet-sdk-node-client`): `NodeClient.Service` gains required `getFinalizedBlock()` and
`getGenesisHash()` methods. Callers are unaffected; implementers must add them.