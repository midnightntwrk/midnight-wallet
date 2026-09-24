# @midnightntwrk/wallet-sdk-testkit

## 1.0.0-rc.5

### Patch Changes

- db9102e: chore: cut the first 2.x release candidate — republish the v2 line under the `rc` dist-tag
- Updated dependencies [db9102e]
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0-rc.3
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-rc.5
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-rc.5
  - @midnightntwrk/wallet-sdk-dust-wallet@5.0.0-rc.5
  - @midnightntwrk/wallet-sdk-facade@5.0.0-rc.5
  - @midnightntwrk/wallet-sdk-hd@3.1.0-rc.4
  - @midnightntwrk/wallet-sdk-indexer-client@2.0.0-rc.3
  - @midnightntwrk/wallet-sdk-shielded@4.0.0-rc.5
  - @midnightntwrk/wallet-sdk-unshielded-wallet@4.0.0-rc.5
  - @midnightntwrk/wallet-sdk-utilities@1.2.2-rc.1

## 1.0.0-beta.4

### Minor Changes

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

- 94c69ec: feat(testkit)!: monitor the projections dust sync by default, selectable by DUST_SYNC

  The dust and token-transfer healthcheck scenarios now build their wallets on the projections ("event-less") dust sync,
  so the networks they monitor are exercised against a sync model wallets actually run. **Breaking** for anyone relying
  on those scenarios using the event stream; pass `{ dustWallet: eventBasedDustWallet }` to keep it.

  **Breaking:** `saveState` takes the wallet record rather than the facade, because a snapshot has to be written to the
  namespace of the model that produced it. Migrate `saveState(wallet, dir, name)` to `saveState(walletInit, dir, name)`,
  passing what `provideWallet`/`initWalletWithSeed` returned. A stale call fails inside the function, where it is caught
  and logged rather than thrown — the snapshot is silently never written and every later run rebuilds from scratch.

  `DUST_SYNC` selects the model for a whole run, as `events` or `projections`. An unrecognized value is rejected rather
  than defaulted, because a silent fallback means a typo reports a run as covering one model while it covered the other.
  Unset means `events` for testkit-built wallets and `projections` for those two scenarios. `provideWallet` and
  `initWalletWithSeed` take `dustWallet` and `manualSync` options that pin a model regardless of the environment — which
  is what a test comparing the two models needs, since a control that follows the run is no control at all.

  New exports from the root and `/core`: `eventLessDustWallet`, `eventBasedDustWallet`, `dustWalletFor`,
  `dustWalletFromEnv`, `dustSyncModelFromEnv`, `dustSyncModelOf`, `parseDustSyncModel`, `dustSnapshotPath`,
  `withProjectionsDefault`, `manualProjectionsDustSyncOptions`, `waitForStableState`, `shouldPersistState`,
  `DUST_SYNC_ENV_VAR`, and the `DustWalletFactory`, `DustSyncModel` and `DustSnapshotModel` types. `eventLessDustWallet`
  is now the shipped two-variant dust wallet with the V2 variant's sync service swapped for the projections one, so it
  reaches that sync on a chain running ledger-v9 from its first block and still builds transactions.

  Dust snapshots are namespaced by the model that wrote them: the two disagree on what a snapshot's single progress
  value means, so restoring one into the other resumes at a wrong position. Namespacing degrades a model switch to a
  from-scratch build instead.

  The settling state waiters applied their window to the source rather than to the predicate, so a wallet syncing in the
  background — projections emits about every five seconds — starved them until the test timeout while logging that the
  condition was already satisfied. They now also answer with the newest value satisfying the predicate rather than the
  one from when it first held: `pendingCoins.length === 0` is equally true either side of a balance arriving, so the old
  answer could be the stale pre-transaction state the window exists to avoid. And the token-transfer healthcheck settles
  pending coins before asserting on them.

### Patch Changes

- ac825c0: chore: upgrade `@midnightntwrk/ledger-v9` to 1.0.0-rc.5 (proof server stays at 9.0.0-rc.7, the build
  ledger-v9 rc.5 declares)
- Updated dependencies [48aaef5]
- Updated dependencies [83eb454]
- Updated dependencies [94c69ec]
- Updated dependencies [7025e69]
- Updated dependencies [3ccc26e]
- Updated dependencies [0bf816a]
- Updated dependencies [a621abc]
- Updated dependencies [a12155a]
- Updated dependencies [59e9260]
- Updated dependencies [ac825c0]
- Updated dependencies [12ca8b1]
  - @midnightntwrk/wallet-sdk-hd@3.1.0-beta.3
  - @midnightntwrk/wallet-sdk-shielded@4.0.0-beta.4
  - @midnightntwrk/wallet-sdk-dust-wallet@5.0.0-beta.4
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0-beta.2
  - @midnightntwrk/wallet-sdk-facade@5.0.0-beta.4
  - @midnightntwrk/wallet-sdk-unshielded-wallet@4.0.0-beta.4
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-beta.4
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-beta.4

## 1.0.0-beta.3

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

- 5d25685: fix(testkit): correct state-waiters that no longer waited for the intended condition

  Several `state-waiters` helpers resolved prematurely (or hung) after `submitTransaction` began recording an optimistic
  _pending_ tx-history entry on submit (facade #365):

  - `waitForTxInHistory` treated any entry whose top-level `status` was not exactly `'SUCCESS'` as terminal, so it
    aborted on the freshly-inserted pending entry (`status` undefined) and asserted
    `expected undefined to be 'SUCCESS'`. It now only aborts on a genuinely terminal outcome
    (`lifecycle.status === 'rejected'`, or `status` `'FAILURE'`/`'PARTIAL_SUCCESS'`) and keeps waiting while the tx is
    still pending. This unblocks the token-transfer `@healthcheck` (and the downstream sentinel monitoring that consumes
    it).
  - `waitForStateAfterDustRegistration` treated "tx present in history" as "tx confirmed", which is now true the instant
    a tx is submitted. It now requires the entry's `status === 'SUCCESS'`.
  - `waitForFinalizedShieldedBalance` resolved on the resting pre-transaction state (`pendingCoins.length === 0` is also
    the idle condition). It now debounces until the state settles before checking.
  - `waitForFacadePending` could hang until the whole-test timeout if the pending window was missed. It now fails fast
    (2 min) with a descriptive error.

- 5d25685: Fix uninstallable `wallet-sdk-testkit@0.2.0`. That release shipped its internal `wallet-sdk-*` dependencies
  (and the `wallet-sdk-utilities` peer) as the monorepo-only `workspace:^` specifier, which leaked into the published
  tarball on both the `@midnightntwrk` and `@midnight-ntwrk` scopes. External installs failed (`npm` →
  `EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`, `yarn` classic → "Couldn't find any versions ... that
  matches workspace:^"). This release publishes those dependencies with concrete versions, restoring installability.
- Updated dependencies [5d25685]
- Updated dependencies [1cf94a3]
- Updated dependencies [5d25685]
- Updated dependencies [b9c1150]
  - @midnightntwrk/wallet-sdk-indexer-client@2.0.0-beta.2
  - @midnightntwrk/wallet-sdk-dust-wallet@5.0.0-beta.3
  - @midnightntwrk/wallet-sdk-shielded@4.0.0-beta.3
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0-beta.1
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-beta.3
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-beta.3
  - @midnightntwrk/wallet-sdk-facade@5.0.0-beta.3
  - @midnightntwrk/wallet-sdk-hd@3.1.0-beta.2
  - @midnightntwrk/wallet-sdk-unshielded-wallet@4.0.0-beta.3
  - @midnightntwrk/wallet-sdk-utilities@1.2.2-beta.0

## 0.3.0-beta.2

### Patch Changes

- 3c06af2: chore: upgrade ledger to 1.0.0-rc.3
- Updated dependencies [1f7aaca]
- Updated dependencies [3c06af2]
  - @midnightntwrk/wallet-sdk-unshielded-wallet@4.0.0-beta.2
  - @midnightntwrk/wallet-sdk-facade@5.0.0-beta.2
  - @midnightntwrk/wallet-sdk-shielded@4.0.0-beta.2
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-beta.2
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-beta.2
  - @midnightntwrk/wallet-sdk-dust-wallet@5.0.0-beta.2

## 0.3.0-beta.1

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
  - @midnightntwrk/wallet-sdk-facade@5.0.0-beta.1
  - @midnightntwrk/wallet-sdk-unshielded-wallet@4.0.0-beta.1
  - @midnightntwrk/wallet-sdk-shielded@4.0.0-beta.1
  - @midnightntwrk/wallet-sdk-dust-wallet@5.0.0-beta.1
  - @midnightntwrk/wallet-sdk-indexer-client@1.3.0-beta.1
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-beta.1
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-beta.1
  - @midnightntwrk/wallet-sdk-hd@3.1.0-beta.1

## 0.3.0-beta.0

### Minor Changes

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

- Updated dependencies [2e616b1]
- Updated dependencies [3ee8186]
- Updated dependencies [44bbcae]
- Updated dependencies [ef16433]
- Updated dependencies [ce4cd19]
- Updated dependencies [44bbcae]
- Updated dependencies [ce4cd19]
- Updated dependencies [89d54b6]
- Updated dependencies [ef16433]
  - @midnightntwrk/wallet-sdk-unshielded-wallet@4.0.0-beta.0
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.4-beta.0
  - @midnightntwrk/wallet-sdk-dust-wallet@5.0.0-beta.0
  - @midnightntwrk/wallet-sdk-hd@3.1.0-beta.0
  - @midnightntwrk/wallet-sdk-facade@5.0.0-beta.0
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-beta.0
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-beta.0
  - @midnightntwrk/wallet-sdk-shielded@4.0.0-beta.0

## 0.2.0

### Minor Changes

- 3c1dfa0: Add `@midnightntwrk/wallet-sdk-testkit`, a publishable package that extracts the reusable wallet e2e harness
  (environment provisioning, wallet bootstrapping, sync waiters, tx-history assertions) so downstream consumers can
  share it instead of vendoring copies. Endpoints are injected via a `WalletTestEnvironment` config
  (`createRemoteEnvironment` / `createTestContainersEnvironment`) rather than read from `process.env`. Shared
  healthcheck scenarios are single-sourced via `registerDustHealthchecks` and `registerTokenTransferHealthchecks`.

### Patch Changes

- Updated dependencies [dff5706]
- Updated dependencies [54a9c4d]
- Updated dependencies [417d042]
- Updated dependencies [e0097fc]
  - @midnightntwrk/wallet-sdk-dust-wallet@4.2.0
  - @midnightntwrk/wallet-sdk-facade@4.1.0
  - @midnightntwrk/wallet-sdk-shielded@3.0.2
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.3
  - @midnightntwrk/wallet-sdk-hd@3.0.3
