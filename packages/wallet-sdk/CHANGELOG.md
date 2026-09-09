# @midnightntwrk/wallet-sdk

## 2.0.0-beta.4

### Patch Changes

- Updated dependencies [3ccc26e]
- Updated dependencies [3ccc26e]
  - @midnightntwrk/wallet-sdk-facade@5.0.0-beta.4
  - @midnightntwrk/wallet-sdk-node-client@2.0.0-beta.4
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-beta.4
  - @midnightntwrk/wallet-sdk-dust-wallet@5.0.0-beta.4
  - @midnightntwrk/wallet-sdk-shielded@4.0.0-beta.4
  - @midnightntwrk/wallet-sdk-unshielded-wallet@4.0.0-beta.4

## 2.0.0-beta.3

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
  - @midnightntwrk/wallet-sdk-node-client@2.0.0-beta.3
  - @midnightntwrk/wallet-sdk-prover-client@2.0.0-beta.3
  - @midnightntwrk/wallet-sdk-runtime@1.1.0-beta.1
  - @midnightntwrk/wallet-sdk-unshielded-wallet@4.0.0-beta.3
  - @midnightntwrk/wallet-sdk-utilities@1.2.2-beta.0

## 2.0.0-beta.2

### Patch Changes

- 3c06af2: chore: upgrade ledger to 1.0.0-rc.3
- Updated dependencies [1f7aaca]
- Updated dependencies [3c06af2]
  - @midnightntwrk/wallet-sdk-unshielded-wallet@4.0.0-beta.2
  - @midnightntwrk/wallet-sdk-facade@5.0.0-beta.2
  - @midnightntwrk/wallet-sdk-shielded@4.0.0-beta.2
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-beta.2
  - @midnightntwrk/wallet-sdk-prover-client@2.0.0-beta.2
  - @midnightntwrk/wallet-sdk-capabilities@4.0.0-beta.2
  - @midnightntwrk/wallet-sdk-dust-wallet@5.0.0-beta.2
  - @midnightntwrk/wallet-sdk-node-client@2.0.0-beta.2

## 2.0.0-beta.1

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
  - @midnightntwrk/wallet-sdk-node-client@2.0.0-beta.1
  - @midnightntwrk/wallet-sdk-prover-client@2.0.0-beta.1
  - @midnightntwrk/wallet-sdk-runtime@1.0.6-beta.0
  - @midnightntwrk/wallet-sdk-address-format@4.0.0-beta.1
  - @midnightntwrk/wallet-sdk-hd@3.1.0-beta.1

## 2.0.0-beta.0

### Major Changes

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
  - @midnightntwrk/wallet-sdk-node-client@2.0.0-beta.0
  - @midnightntwrk/wallet-sdk-prover-client@2.0.0-beta.0
  - @midnightntwrk/wallet-sdk-shielded@4.0.0-beta.0

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
