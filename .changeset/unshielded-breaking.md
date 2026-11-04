---
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
---

Breaking changes since 3.x

- **Two ledger versions.** `UnshieldedWallet(configuration)` runs a ledger-v8 variant (V1) below `forks.v9` and a
  ledger-v9 variant (V2) from it, and hands the wallet over when the chain crosses. `forks` is required, and
  `DefaultUnshieldedConfiguration` is declared by the package. `startWithPublicKey` returns a `Promise`: a fresh start
  asks the chain the protocol version of its first block (`chainVersionProbe`, by default the indexer) to pick the
  variant, falling back to V1 if the probe fails, and an ECDSA key always starts on V2.
- **Keys and signatures.** `createKeystore` takes an `UnshieldedSecretKey`, `{ kind: 'schnorr' | 'ecdsa', secret }`,
  instead of a bare `Uint8Array` secret key, and keys and signatures are tagged `{ tag, value }` objects rather than
  strings (`PublicKey.publicKey`, `getPublicKey()`). The ledger-v8 keystore, which takes a `Uint8Array` and has no
  ECDSA, moves from the package root to `./v1`.
- **Asynchronous signing.** `signUnprovenTransaction` and `signUnboundTransaction` take a `SignSegment`,
  `(data: Uint8Array) => Promise<Signature>`, so a signer whose secret never enters the process, such as an MPC
  coordinator or an HSM, can sign. Keystores keep `signData` and add `signDataAsync`, which can be passed as the signer
  directly: `wallet.signUnprovenTransaction(tx, keystore.signDataAsync)`. A signer that rejects fails with `SignError`.
  Signing has moved off `TransactingCapability` into a per-variant `SigningService`.
- **Transactions.** Methods take and return `WalletTransaction` handles stamped with the protocol version they were
  built for. A handle for the other ledger version is refused with `ProtocolVersionMismatchError`, except by
  `revertTransaction` and `revertFailedSegments`, which ignore it.
- **Sync completion waits for indexer liveness.** The wallet cross-checks the indexer's reported tip against the node's
  finalized head, polling `nodeClientConnection`, or else `relayURL`, every 30 seconds; a wallet that names neither is
  not checked. `isStrictlyComplete()`, `isCompleteWithin()` and `waitForSyncedState()` also need a first verdict that
  does not block: `Behind`, `Unknown` and `WrongNetwork` block, `InSync`, `Ahead`, `Unavailable` and `Skipped` do not. A
  failed poll keeps a `Behind` or `WrongNetwork` verdict, so a node outage cannot release a caller waiting on a stale
  indexer. Against a stale indexer `waitForSyncedState()` neither rejects nor times out: race it against your own
  deadline and read `progress.indexerLiveness`. Tune the check with `livenessConfiguration` and `livenessPollInterval`.
  `SyncProgressData` gains a required `indexerLiveness`, defaulted by `createSyncProgress()`.
- **API types.** `UnshieldedWalletState.state` is sealed: read it with `coreStateOf` from `./v1` or `./v2`. The state
  loses `capabilities`, `services` and `mapState` (use `fromVariant`), and its constructor takes
  `(protocolVersion, state, projections)` in place of `(state, capabilities, services)`. `UnshieldedWalletCapabilities`
  and `UnshieldedWalletServices` are removed. `UnshieldedWalletAPI` requires `revertFailedSegments`, `revertUtxos` and
  `releaseRestoredPending`.
- **Errors.** The `WalletError` union of `./v1` and `./v2` gains `SnapshotRestoreError` and `OutOfOrderSyncUpdateError`,
  and that of `./v2` also `SchemeMismatchError`, so an exhaustive match over it must handle them.
- **`CustomUnshieldedWallet`** composes one ledger-v9 variant, from a V2 builder, instead of a ledger-v8 one; its start
  stays synchronous, and it cannot cross a fork.
- **Custom implementations.** `SyncService.livenessUpdates` is required: a source with nothing to check emits one
  `IndexerLiveness.Skipped({ reason: 'no-liveness-feed' })` and ends. The sync update union gains `VersionSignal` and
  indexer-liveness members, and `applyUpdate` receives the protocol-version range its variant owns.
  `UnshieldedState.spend` and `spendByUtxo`, and `CoreWallet.spend` and `spendUtxos`, take the transaction's TTL, and
  pending entries are `{ utxo, ttl, restored }`. `TransactingCapability` requires `revertFailedSegments`, `revertUtxos`
  and `releaseRestoredPending`, and `TransactionOps` requires `collectSignableData`, `attachSignatures` and
  `extractOwnFailedFallibleInputs`. The `./v1` `Simulator` is the capabilities `V8` simulator, without
  `getBlockEventsSince`.
- **Transaction history.** `txHistoryStorage` is an `UnshieldedHistoryStorage`. An entry's `unshielded` section is
  optional, and unshielded entries no longer record `fees`.
- **Snapshots.** V1 writes format `v1` and V2 writes `v2` (with a tagged key), each recording `writtenBy`; a 3.x
  snapshot restores on V1 and crosses as schnorr. An unreadable snapshot is refused with `SnapshotRestoreError`, and
  `restore` throws that tagged error. A snapshot whose stored address does not derive from its key is refused.
- **Indexer.** The sync reads `protocolVersion` from the indexer's progress frames and the block hash and height of each
  transaction, so it needs an indexer that serves them. The SDK is tested against indexer `4.4.0-rc.6`.
- **Dependencies.** Depends on `@midnightntwrk/ledger-v9` `1.0.0-rc.7` beside `@midnight-ntwrk/ledger-v8`.
