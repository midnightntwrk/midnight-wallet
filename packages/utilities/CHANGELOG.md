# @midnightntwrk/wallet-sdk-utilities

## 1.2.2-beta.0

### Patch Changes

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

## 1.2.0

### Minor Changes

- 6e187fe: Fix a race where Dust registration / deregistration would double-use Night UTxOs that another in-flight
  transaction was already trying to spend. The build flow now books the chosen Night UTxOs (available → pending) at
  build time, so a conflicting concurrent build fails immediately with `SpendUtxoError` instead of only at submission.
  Adds new methods on `UnshieldedWallet` (`rotateUtxos`) and `DustWallet` (`splitNightUtxosForDustRegistration`,
  `attachDustRegistration`) to support the split build.

### Patch Changes

- 7452e96: Bump `@midnight-ntwrk/ledger-v8` from `^8.0.3` to `^8.1.0`. Internal balancing flows in `dust-wallet`,
  `unshielded-wallet`, and `shielded-wallet` are refactored to use the new ledger 8.1.0 builder API
  (`Transaction.addIntent`, `Transaction.addZswapOffer`) instead of post-construction field mutation on
  `Transaction.fromParts(...)`. No public API changes; consumers must resolve `@midnight-ntwrk/ledger-v8` to `>=8.1.0`.

## 1.1.1

### Patch Changes

- 0db3290: chore: bump ledger version to 8.0.3
- 7f82432: Introduce a shared transaction history storage layer with support for wallet-specific augmentation.
  Reimplement shielded wallet transaction history and refactor unshielded wallet transaction history to use the new
  shared storage.

## 1.1.0

### Minor Changes

- aa7b1f4: chore: update ledger to v8

### Patch Changes

- ea55591: fix: move dev-only deps out of dependencies

## 1.1.0-rc.0

### Minor Changes

- aa7b1f4: chore: update ledger to v8

### Patch Changes

- ea55591: fix: move dev-only deps out of dependencies

## 1.0.1

### Patch Changes

- 55380e5: feat: adds safe bigint schema
- 330867f: fix: prevent fromStream leaving dangling hub subscriber on early unsubscribe

## 1.0.1-rc.1

### Patch Changes

- 55380e5: feat: adds safe bigint schema

## 1.0.1-rc.0

### Patch Changes

- 330867f: fix: prevent fromStream leaving dangling hub subscriber on early unsubscribe

## 1.0.0

### Patch Changes

- fb55d52: Provide getBytes to allow browser compliant bytes for Blob
- f7aac06: Update blockchain dependencies to latest versions:
  - Upgrade `@midnight-ntwrk/ledger-v7` from `7.0.0-rc.1` to `7.0.0` (stable release)
  - Update `indexer-standalone` Docker image from `3.0.0-alpha.25` to `3.0.0-rc.1`
  - Update `midnight-node` Docker image from `0.20.0-rc.1` to `0.20.0-rc.6`

- aef8d4b: Performance improvement: Shielded and Dust wallet now send events in batches of 50 or after 10 seconds if
  total events has not reached 50
- 8b8d708: chore: update ledger to version 7.0.0-rc.1
- fb55d52: chore: initialize baseline release after introducing Changesets
- fb55d52: chore: force re-release after workspace failure
- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs
- fb55d52: chore: bump ledger to version 6.1.0-beta.5

## 1.0.0-beta.11

### Patch Changes

- f7aac06: Update blockchain dependencies to latest versions:
  - Upgrade `@midnight-ntwrk/ledger-v7` from `7.0.0-rc.1` to `7.0.0` (stable release)
  - Update `indexer-standalone` Docker image from `3.0.0-alpha.25` to `3.0.0-rc.1`
  - Update `midnight-node` Docker image from `0.20.0-rc.1` to `0.20.0-rc.6`

## 1.0.0-beta.10

### Patch Changes

- 8b8d708: chore: update ledger to version 7.0.0-rc.1

## 1.0.0-beta.9

### Patch Changes

- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs

## 1.0.0-beta.8

### Patch Changes

- aef8d4b: Performance improvement: Shielded and Dust wallet now send events in batches of 50 or after 10 seconds if
  total events has not reached 50

## 1.0.0-beta.7

### Patch Changes

- 976628a: Provide getBytes to allow browser compliant bytes for Blob
- 1db4280: chore: bump ledger to version 6.1.0-beta.5

## 1.0.0-beta.6

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure

## 1.0.0-beta.5

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
