# @midnightntwrk/wallet-sdk-capabilities

## 4.0.0-beta.3

### Major Changes

- cb6f7c2: feat(sdk)!: state the fork schedule as a map keyed by ledger version

  The wallet, facade and block-data-fetcher configurations take `forks: { v9 }` — the protocol version from which
  ledger-v9 reads the chain — in place of the single `forkVersion`. The value and its meaning are unchanged; only the
  shape is. A single number could name one boundary and no more, so the next hard fork would have changed the shape of
  every application's configuration. A map keyed by ledger version adds a key (`v10`) instead, which is why the change
  is made now, while 2.0 is still in beta. The type is `ProtocolVersion.ForkSchedule` in the abstractions package;
  ledger-v8 begins at `MinSupportedVersion` and has no entry, and every entry stays required in the wallet packages, for
  the same reason as before: where a chain forks is a fact about the chain, not the SDK. The facade presets
  `DefaultForkSchedule` when `forks` is left out — see its own changeset.

  BREAKING CHANGE — replace the field in every configuration you build:

  ```ts
  // before
  { forkVersion: ProtocolVersion.V9NativeForkVersion, ... }
  // after
  { forks: { v9: ProtocolVersion.V9NativeForkVersion }, ... }
  ```

  Factories that take a single boundary directly (`defaultLedgerParametersCodecs(forkVersion)`,
  `ProtocolVersion.epochOf`) are unchanged; the facade passes `configuration.forks.v9` to them. Proving takes the whole
  schedule, since its backends are keyed the same way — see the proving changeset.

- b9c1150: Hard-fork support. A wallet runs ledger-v8 (`@midnight-ntwrk/ledger-v8`) below the chain's fork version and
  ledger-v9 (`@midnightntwrk/ledger-v9`) from it, and follows a live chain across the boundary: balances, coins and
  transaction history survive the crossing, and a wallet restored from a V1 snapshot crosses too. Applications no longer
  import a ledger package.

  ### Breaking: configuration and starting
  - `forks.v9` is required in the shielded, dust and unshielded configurations: the protocol version at which the chain
    switches ledgers. There is no default in the wallet packages. `ProtocolVersion.V9NativeForkVersion`, from the
    abstractions package, is the value a 2.x chain reports (2000000); the final mainnet constant is not fixed yet, so
    supply it per environment. The facade presets this value when `forks` is left out — see the facade changeset.
  - `chainVersionProbe` is a new optional setting on all three wallets. By default a wallet asks the indexer, on every
    start, which protocol version the chain's first block was produced under, with a 5-second timeout, and starts on the
    matching side. A failed probe never fails a start: the wallet starts on V1 and crosses on its first synced update. A
    custom probe must answer the same question.
  - Wallets start from seeds. On `ShieldedWallet(...)` and `DustWallet(...)`, `startWithSecretKeys` and
    `startWithSecretKey` are removed; `startWithSeed(seed)` and `startWithKeys({ v8, v9 })` replace them and return a
    `Promise`. The unshielded `startWithPublicKey` also returns a `Promise` now. The single-variant
    `CustomShieldedWallet` and `CustomDustWallet` keep their synchronous starts and cannot cross a fork. The instance
    method `start(secretKeys)` stays and is right for a wallet restored at or past the fork.
  - Dust parameters are optional. `DustWallet(...).startWithSeed(seed, dustParameters?)` and
    `DefaultDustConfiguration.dustParameters` take a plain `DustGenerationRates` object and default to the ledger's
    initial parameters.
  - The facade starts from `WalletSeeds.fromMasterSeed(masterSeed)` or from `FacadeKeysByEpoch`
    (`{ v8: { shielded, dust }, v9: { shielded, dust } }`). Its third `start` argument is now an options object
    (`{ manualSync?: boolean }`), and `doSync` takes the same start material as `start`.
  - The `secretKeys` parameter is gone from every transaction-building method. A stopped wallet drops its key material;
    transacting after `stop()` fails with `MissingStartAuxError`.

  ### Breaking: transactions carry the version that built them
  - Every facade and wallet method that took or returned a ledger transaction now uses `WalletTransaction`, a handle
    that records the protocol version the transaction was built for. A handle from the other side of the fork is refused
    with `ProtocolVersionMismatchError`, which names the version in `authoredFor`. Applications that build their own
    transactions import `@midnightntwrk/wallet-sdk/ledger/v8` or `/ledger/v9` (not re-exported from the root) and seal
    the result with `WalletTransaction.adopt('Unproven', tx, protocolVersion)`. Handles serialize with `toWire` and
    `fromWire`. Authoring against `/ledger/v9` on a chain that has not crossed compiles and fails at run time.
  - `FacadeState.pending` is now an array of `{ transaction, submittedAt, authoredFor, status }`; the pending-set object
    it used to be is gone. `status` is `Submitted`, `Confirmed`, `Rejected` or `Orphaned` (`{ authoredFor, chainNow }`).
    A transaction still pending at the fork is orphaned: it can never be included, so its coins are released and history
    records the rejection with reason `orphaned-by-protocol-upgrade`. `revert` and `revertTransaction` accept an
    optional reason. The unshielded `revertTransaction` ignores a handle from the other side of the fork.
  - Facade recipes (`FinalizedTransactionRecipe`, `UnboundTransactionRecipe`, `UnprovenTransactionRecipe`) gain a
    required `protocolVersion`, and `BlockData` gains a required `protocolVersion`.
  - Proving, validation and block ledger-parameter reads route on the transaction's version. Configure a proving backend
    per ledger version as `provers: { v8, v9 }`; `provingServerUrl` remains for a single server. Both fields of
    `DefaultProvingConfiguration` are optional and a configuration with neither fails with `ProvingConfigurationError`.
    `defaultLedgerParametersCodecs(forkVersion)` is the version-routed codec set.

  ### Breaking: the wallet packages' root API
  - `ShieldedWalletState`, `DustWalletState` and `UnshieldedWalletState` lose their `capabilities` and `services` fields
    and the static `mapState`; `fromVariant` replaces it and the constructor is `(protocolVersion, state, projections)`.
    Their `state` is a union of the V1 and V2 core states. The unshielded `UnshieldedWalletCapabilities` and
    `UnshieldedWalletServices` types are deleted. Shielded `BalancingResult` is renamed `ShieldedBalancingResult`.
  - `DefaultShieldedConfiguration`, `DefaultDustConfiguration` and `DefaultUnshieldedConfiguration` are declared by each
    package rather than aliased to a variant's; the testkit's configuration types follow.
  - The `./v1` subpath of each wallet package, and `shielded/v1`, `dust/v1`, `unshielded/v1` in
    `@midnightntwrk/wallet-sdk`, now export the ledger-v8 wallet. The ledger-v9 wallet moved to `./v2` with `V1`-named
    exports renamed to `V2`. `./v1` is not a plain copy: the dust `./v1` has no projections-based fast sync (it rests on
    ledger-v9 APIs); the unshielded `./v1` has its own `createKeystore` whose secret is a plain `Uint8Array`, no ECDSA,
    and no `SchemeMismatchError`; `Simulator` on `./v1` is the ledger-v8 simulator only. Both subpaths gain a
    `Migration` namespace, and their builders gain `withStartAux`, `withStartAuxDefaults`, `withMigration` and
    `withMigrationDefaults`.
  - Root entry points keep their names and gain the forking wallet types, `ProtocolVersion.V9NativeForkVersion`,
    `DustGenerationRates` with `asV8DustParameters` and `asV9DustParameters`, and snapshot inspection: `Restore`
    (shielded) and `UnshieldedRestore` namespaces, and the dust `peekProtocolVersion` and
    `UnsupportedSnapshotVersionError`.
  - Existing snapshots restore; `restore` and the new `tryRestore` route on the protocol version a snapshot declares,
    and `tryRestore` returns the reason a snapshot cannot be read instead of throwing. Shielded snapshots written
    mid-crossing carry `coinHashesPending`, and pending-transaction entries now record their protocol version.
  - Sync types: the shielded and dust `WalletSyncUpdate` are tagged unions on `_tag`, the unshielded one is
    discriminated on `type` (its indexer-decoded shape is exported as `IndexerSyncUpdate`), and all three gain a
    `VersionSignal` member. Shielded and dust event schemas deliver events as raw hex, decoded by the variant that
    applies them; the unshielded progress frame requires `protocolVersion`. Custom sync capabilities receive the
    protocol-version range they own as a third `applyUpdate` argument and must leave updates at or beyond it unapplied.
    Exported helpers implement the rule; ignoring the argument keeps the old behaviour.

  ### Breaking: runtime, capabilities and abstractions

  For code that composes wallets or test fixtures by hand.

  - Abstractions: `ProtocolState` requires a `variantTag` and `getEquivalence` compares it. `ProtocolVersion.Registry`
    (`makeRegistry`, `makeRegistryFromActivations`, `select`, `selectEntry`) picks the implementation for a protocol
    version; `ProtocolVersion.epochOf` says which side of a fork a version is on. New errors `RegistryError` and
    `InvalidTokenTypeError`.
  - Runtime: `Variant.migrateState` may fail with `WalletRuntimeError`.
    `withVariant(sinceVersion, builder, configuration?)` accepts a per-variant configuration.
    `VariantContext.activationRange` carries the variant's version range and `Runtime.onVariantActivation` fires when a
    migration activates one. New `StartMaterial` module, `RuntimeState`, `variantFor` and `startAtVariant`.
  - Capabilities: new subpaths `./chainVersion` (`timelineStartChainVersion`, `BlockVersionAnswer`,
    `makeIndexerChainVersionProbe`, `ChainVersionUnavailableError`), `./codecs` (`makeCodecs`, `decode`,
    `UnsupportedProtocolVersionError`, `LedgerParametersDecodeError`) and `./signatures` (`Signing`,
    `UnsupportedSignatureKindError`). Pending transactions are versioned: `addPendingTransaction(tx, protocolVersion)`,
    new `orphanBeyond(chainNow)`, `txTraits: VersionedTransactionTrait`, `OrphanedByForkResult`, `allOrphaned`,
    `allRejected`. Proving and validation services are `VersionedProvingService` and `VersionedValidationService`
    (`validateTx(tx, protocolVersion, options)`), with `UnsupportedProvingVersionError` and
    `UnsupportedValidationVersionError`; the facade's injectable services take these shapes.
  - Simulation: one simulator per ledger version, `V8` and `V9`; the v9 names stay exported unqualified, so existing
    imports are unaffected. `ForkSimulator` drives one chain across a boundary and requires a `translator`
    (`LedgerStateTranslator`, `translatorFromAsync`, `unavailableTranslator`). Simulators gain a protocol-version
    timeline: `SimulatorConfig.protocolVersion`, `setProtocolVersion`, `scheduleFork`, `produceEmptyBlock`, and
    `protocolVersion` on blocks.
  - Indexer client: `protocolVersion` is read on `BlockHash`, `DustLedgerEvents`, `DustNullifierTransactions` and the
    unshielded progress frame. New id-only subscriptions `ZswapEventTip` and `DustLedgerEventTip`.
  - HD: `WalletSeeds.fromMasterSeed(masterSeed, { account?, addressIndex?, unshieldedRole? })` derives the three
    per-wallet seeds at `m/44'/2400'/account'/role/index` (roles 0 unshielded, 2 dust, 3 shielded;
    `Roles.EcdsaUnshielded` for an ECDSA unshielded identity), throws `SeedDerivationError`, and is specified with test
    vectors in the wallet specification.
  - Umbrella: new subpath `capabilities/codecs`; the root exports `Token.night`, `parseTokenType`, `Signing` and
    `UnsupportedSignatureKindError`, so token types and signatures need no ledger import.

  ### Behaviour at the fork
  - `FacadeState.protocolVersion`, `activeProtocolVersion` and `protocol` report where the wallets are: `Settled`
    (`{ version }`) or `Crossing` (`{ from, to, behind }`).
  - The shielded wallet carries its local state across as bytes, coins at their positions in the commitment tree. Coin
    commitments and nullifiers need keys a migration lacks, so they are computed on the first synced update after the
    crossing; until then `balances`, `availableCoins` and `pendingCoins` read empty, and a snapshot written in that
    window restores. The dust wallet starts empty and rebuilds from the chain, which wipes and replays dust at the fork.
    Unshielded state is copied field by field; UTxOs booked by transactions still pending at the fork return to the
    available balance. After a migration each wallet restarts its own sync; `stop` prevents a late restart.
  - Wallet state records the protocol version the indexer reports and it only ever increases, so replayed history cannot
    drag a wallet back across the boundary.
  - A wallet with no traffic of its own still notices the fork. The unshielded wallet reads the version off its progress
    frames and adopts it once caught up to the frame's highest transaction id. Shielded and dust re-ask the chain's tip
    on a timer (`DefaultSyncConfiguration.versionWatch.intervalMs`, default 30 s, zero or less disables), and record it
    only once level with the far end of their own event timeline, so a hand-over never outruns unread history.
  - Carried Night UTxOs cross with `registeredForDustGeneration: false`, matching what the indexer reports after the v9
    fork, so re-registering for dust generation on ledger-v9 funds its own fee.
    `claimableFeePayment(dustState, nightUtxos, now)` is exported for callers that want the amount
    `waitForGeneratedDust` waits on.
  - Known limitations: shielded spends pending at the fork stay locked afterwards until the ledger offers a way to clear
    them; the dust projections-based fast sync does not hand over at a fork on its own (only relevant at a future fork)
    and now logs its resume cursors at debug level; a fresh dust wallet on a chain that forked over history replays the
    ledger-v8 dust events before crossing.

  ### Dependencies
  - `@midnightntwrk/ledger-v9` `1.0.0-rc.4`. Its dust spend circuit differs from rc.3, so an rc.4 chain rejects proofs
    from a proof server built for rc.3. Proof-server image tags do not track ledger tags: run `9.0.0-rc.7`, the build
    the rc.4 ledger declares. The `./testing` containers in `@midnightntwrk/wallet-sdk-utilities` default to it.
  - `@midnight-ntwrk/ledger-v8` is now a runtime dependency of the capabilities, wallet, facade, testkit and umbrella
    packages, so browser bundles load two ledger WASM modules.

- 94fa413: refactor(sdk)!: name the two sides of a fork by version, never by position

  Every name that placed itself relative to the `forks.v9` boundary, or called one side "current", now names a version
  instead: wallet code by variant, `V1`/`V2`; ledger material by ledger version, `V8`/`V9`. Positional names stop
  meaning anything once a second fork exists, and "current" is wrong the day after it; version numbers do not move. The
  rule lives in CLAUDE.md under "Naming the two sides of a fork", and `scripts/check-fork-vocabulary.mjs` enforces it in
  `verify:check` and CI. The hard-fork API this renames has not shipped, so the pending release notes simply use the
  final names.

  BREAKING CHANGE — the ledger-v9 twins of exports that already carried `V8` now carry `V9` too, and these had shipped.
  In `@midnightntwrk/wallet-sdk-capabilities/proving`, present since 3.3.1:

  | Before                                                                                                                                                                     | After                                                                                                                                                                                  |
  | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `fromProvingProviderEffect`, `fromProvingProvider`, `makeServerProvingServiceEffect`, `makeWasmProvingServiceEffect`, `makeServerProvingService`, `makeWasmProvingService` | `fromV9ProvingProviderEffect`, `fromV9ProvingProvider`, `makeV9ServerProvingServiceEffect`, `makeV9WasmProvingServiceEffect`, `makeV9ServerProvingService`, `makeV9WasmProvingService` |
  | `UnboundTransaction`                                                                                                                                                       | `V9UnboundTransaction`                                                                                                                                                                 |

  Published in the 4.0.0 betas only: in `…/validation`, `AnyValidatableTransaction`,
  `makeDefaultValidationServiceEffect` and `makeDefaultValidationService` are now `AnyV9ValidatableTransaction`,
  `makeV9ValidationServiceEffect` and `makeV9ValidationService` (the versioned router
  `makeDefaultVersionedValidationService*` keeps its name), and `@midnightntwrk/wallet-sdk-shielded` re-exports
  `V9UnboundTransaction` in place of `UnboundTransaction`. `@midnightntwrk/wallet-sdk` exposes the same names through
  its `./capabilities/proving` subpath.

- 0045ebc: feat(proving)!: name a proving backend per ledger version, with the ranges taken from the fork schedule

  `provers` is a map keyed by ledger version, the way `forks` is, in place of a list of backends each carrying the
  protocol version it starts serving. The boundary between two backends is the chain's fork schedule, and it is now read
  from `forks` alone. A `provers` entry could restate it, and a `sinceVersion` that drifted from `forks.v9` framed the
  versions in between with one ledger and sent them to a server built for the other, which nothing caught at
  configuration time.

  ```ts
  // before
  {
    forks: { v9 },
    provers: [
      { sinceVersion: ProtocolVersion.MinSupportedVersion, backend: { kind: 'server', url: v8ProofServer } },
      { sinceVersion: v9, backend: { kind: 'wasm' } },
    ],
  }
  // after
  { forks: { v9 }, provers: { v8: { kind: 'server', url: v8ProofServer }, v9: { kind: 'wasm' } } }
  ```

  `v9` is required, because every new transaction is proved with it. `v8` may be left out on a chain whose ledger-v8
  history the wallet never authors for; a transaction stamped there then fails with `UnsupportedProvingVersionError`.
  The next hard fork adds a key (`v10`) rather than changing the shape. `provingServerUrl` remains the shorthand for one
  proof server under every key; `provingServers` is gone, since it carried the same `sinceVersion`.

  BREAKING CHANGE (`@midnightntwrk/wallet-sdk-capabilities`) — `ProvingBackends` replaces `ProverActivation` and
  `ProvingServerActivation`; `resolveProvingServers` is removed and `resolveProvingBackends(configuration)` returns the
  `ProvingBackends` map rather than a registry; `makeDefaultProvingServices`, `makeDefaultVersionedProvingServiceEffect`
  and `makeDefaultVersionedProvingService` take the `ProtocolVersion.ForkSchedule` as their second argument in place of
  a single fork version. The facade passes `configuration.forks` for you.

- 376f107: Prove on either side of a protocol boundary. Routing a transaction to a prover by the version stamped on it
  already worked; every backend, however, was bound to ledger-v9 — it drove `Transaction.prove` with ledger-v9's cost
  model, framed its proof-server requests with ledger-v9's payload helpers, and resolved key material at a fixed circuit
  line. A ledger-v8 entry in `provingServers` was therefore accepted by configuration and could not be honoured: handing
  a ledger-v8 transaction ledger-v9's cost model fails at the wasm-bindgen boundary with
  `expected instance of CostModel`. There is now a backend per ledger version, and the registration that says which
  serves which range of protocol versions.

  Proving backends are configured with `provers`, a backend per ledger version, which — unlike a proof server URL — can
  also name the in-process prover:

  ```ts
  const configuration = {
    forks: { v9 },
    provers: { v8: { kind: 'server', url: v8ProofServer }, v9: { kind: 'wasm' } },
  };
  ```

  `provingServerUrl` is unchanged and still supported as the shorthand for one proof server under every key; `provers`
  wins when both are given, and naming neither is still a `ProvingConfigurationError`. The single URL is driven by each
  ledger version on its own side of `forks.v9`, so the same description frames correctly on both sides. Whether one
  proof server can in fact prove both is an operational fact about that server, not something the SDK can enforce: no
  published image serves both today, so a chain with history below the boundary wants `provers` with a server per side.
  The in-process prover works on bytes and does serve both, with the same published circuits.

  Each registered backend refuses the other ledger version's transaction with a new `ProvingEpochMismatchError` naming
  the epoch it serves, rather than passing a foreign object to a ledger that cannot read it.

  BREAKING CHANGE (`@midnightntwrk/wallet-sdk-capabilities`) — `makeDefaultVersionedProvingService` and
  `makeDefaultVersionedProvingServiceEffect` take the chain's fork schedule as a second argument, and a new
  `makeDefaultProvingServices(configuration, forks)` exposes the registry they build. The facade passes
  `configuration.forks` for you; only a direct caller of these factories is affected. `ProvingServiceEffect`'s error
  channel widens from `ProvingError` to `ProvingFailure` (`ProvingError | ProvingEpochMismatchError`) — existing
  implementations stay assignable. The facade's `InitParams.provingService` widens to
  `VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>`, which existing ledger-v9
  implementations also satisfy.

  `@midnightntwrk/wallet-sdk-prover-client` gains `@midnight-ntwrk/ledger-v8` as a runtime dependency, so
  `HttpProverClient` can frame a ledger-v8 request as ledger-v8 would: `asV8ProvingProvider()` alongside the unchanged
  `asProvingProvider()`, which `asV9ProvingProvider()` now also names. Both ledgers are WASM modules, so a consumer
  bundling this package directly now ships both; users of `@midnightntwrk/wallet-sdk` or `-capabilities` already did.
  `WasmProver.makeDefaultKeyMaterialProvider` now takes an optional `{ circuits: 8 | 9 }` naming the circuit line to
  read, defaulting to what both ledger versions accept.

### Patch Changes

- Updated dependencies [5d25685]
- Updated dependencies [883e772]
- Updated dependencies [cb6f7c2]
- Updated dependencies [b9c1150]
- Updated dependencies [376f107]
  - @midnightntwrk/wallet-sdk-indexer-client@2.0.0-beta.2
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0-beta.1
  - @midnightntwrk/wallet-sdk-node-client@2.0.0-beta.3
  - @midnightntwrk/wallet-sdk-prover-client@2.0.0-beta.3
  - @midnightntwrk/wallet-sdk-utilities@1.2.2-beta.0

## 4.0.0-beta.2

### Patch Changes

- 3c06af2: chore: upgrade ledger to 1.0.0-rc.3
- Updated dependencies [3c06af2]
  - @midnightntwrk/wallet-sdk-prover-client@2.0.0-beta.2
  - @midnightntwrk/wallet-sdk-node-client@2.0.0-beta.2

## 4.0.0-beta.1

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
  - @midnightntwrk/wallet-sdk-indexer-client@1.3.0-beta.1
  - @midnightntwrk/wallet-sdk-node-client@2.0.0-beta.1
  - @midnightntwrk/wallet-sdk-prover-client@2.0.0-beta.1

## 4.0.0-beta.0

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

### Minor Changes

- ef16433: Add `WalletFacade.validateTransaction` for pre-submission well-formedness checks. Validation logic lives in a
  new `ValidationService` (in `@midnightntwrk/wallet-sdk-capabilities/validation`); the facade method is a thin
  delegate.

  The signature accepts an options bag — `validateTransaction(tx, { flags, blockData? })` — supporting
  `FinalizedTransaction`, `UnboundTransaction`, and `UnprovenTransaction`. Validation always uses real on-chain ledger
  parameters; if `blockData` is provided it is reused, otherwise the service fetches via the configured
  `fetchBlockData`. Recipes returned by balancing methods (`FinalizedTransactionRecipe`, `UnboundTransactionRecipe`,
  `UnprovenTransactionRecipe`) now expose an optional `blockData` field, carried through `signRecipe`, so callers can
  chain `balance → validate → submit` without a redundant fetch.

  Errors are now typed: `WellFormedError` and `ValidationFetchError` (both `Data.TaggedError`), exported from the
  facade.

  New `InitParams` factories:

  - `validationService` — override the default validation service.
  - `fetchBlockData` — override the default indexer-backed block-data fetcher (use `makeSimulatorBlockDataFetcher` for
    simulator-based tests).

### Patch Changes

- Updated dependencies [44bbcae]
- Updated dependencies [ce4cd19]
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.4-beta.0
  - @midnightntwrk/wallet-sdk-node-client@2.0.0-beta.0
  - @midnightntwrk/wallet-sdk-prover-client@2.0.0-beta.0

## 3.3.1

### Patch Changes

- 7452e96: Bump `@midnight-ntwrk/ledger-v8` from `^8.0.3` to `^8.1.0`. Internal balancing flows in `dust-wallet`,
  `unshielded-wallet`, and `shielded-wallet` are refactored to use the new ledger 8.1.0 builder API
  (`Transaction.addIntent`, `Transaction.addZswapOffer`) instead of post-construction field mutation on
  `Transaction.fromParts(...)`. No public API changes; consumers must resolve `@midnight-ntwrk/ledger-v8` to `>=8.1.0`.
- Updated dependencies [6e187fe]
- Updated dependencies [7452e96]
- Updated dependencies [25f58b4]
  - @midnightntwrk/wallet-sdk-utilities@1.2.0
  - @midnightntwrk/wallet-sdk-node-client@1.1.2
  - @midnightntwrk/wallet-sdk-prover-client@1.2.2
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.2

## 3.3.0

### Minor Changes

- e57a94b: Unify Simulator into capabilities package with proper fee payment and block production model

### Patch Changes

- 0db3290: chore: bump ledger version to 8.0.3
- 7f82432: Introduce a shared transaction history storage layer with support for wallet-specific augmentation.
  Reimplement shielded wallet transaction history and refactor unshielded wallet transaction history to use the new
  shared storage.
- Updated dependencies [e57a94b]
- Updated dependencies [c1ae369]
- Updated dependencies [0db3290]
- Updated dependencies [7f82432]
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.1
  - @midnightntwrk/wallet-sdk-abstractions@2.1.0
  - @midnightntwrk/wallet-sdk-prover-client@1.2.1
  - @midnightntwrk/wallet-sdk-node-client@1.1.1
  - @midnightntwrk/wallet-sdk-utilities@1.1.1

## 3.2.0

### Minor Changes

- aa7b1f4: chore: update ledger to v8

### Patch Changes

- Updated dependencies [9d71d25]
- Updated dependencies [1fa7e03]
- Updated dependencies [ea55591]
- Updated dependencies [aa7b1f4]
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.0
  - @midnightntwrk/wallet-sdk-node-client@1.1.0
  - @midnightntwrk/wallet-sdk-utilities@1.1.0
  - @midnightntwrk/wallet-sdk-prover-client@1.2.0

## 3.2.0-rc.0

### Minor Changes

- aa7b1f4: chore: update ledger to v8

### Patch Changes

- Updated dependencies [9d71d25]
- Updated dependencies [ea55591]
- Updated dependencies [aa7b1f4]
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.0-rc.0
  - @midnightntwrk/wallet-sdk-utilities@1.1.0-rc.0
  - @midnightntwrk/wallet-sdk-prover-client@1.2.0-rc.0
  - @midnightntwrk/wallet-sdk-node-client@1.1.0-rc.0

## 3.1.0

### Minor Changes

- f52d01d: - expose functions for reverting pending coins (booked for a pending transaction) from a provided transaction
  - extract submission into `@midnightntwrk/wallet-sdk-capabilities` package as a standalone service and integrate it
    into the `WalletFacade`
  - make `WalletFacade` revert transaction upon submission failure
  - change initialization of `WalletFacade` to a static async method `WalletFacade.init` taking a configuration object.
    This will allow non-breaking future initialization changes when e.g. new services are being integrated into the
    facade.
- f52d01d: - Create a pending transactions service in the `@midnightntwrk/wallet-sdk-capabilities` package. The service
  checks TTL and status of transactions against indexer in order to report failures. The service state is also meant to
  be serialized and restored in order to not loose track of pending transactions in case of wallet restarts
  - Integrate the pending transactions service into the `WalletFacade`. It registers transactions as soon as they are
    finalized (it can't happen earlier because unproven transactions contain copies of secret keys for proving
    purposes). Whenever a pending transaction is reported as failed - it is reverted. The pending transactions service
    state is also reported in the facade state for serialization purposes and to enable UI reporting.

### Patch Changes

- d3422bc: - Extract proving into a standalone `ProvingService` in the `@midnightntwrk/wallet-sdk-capabilities` package,
  decoupling it from the shielded and dust wallet builders. The new service supports server (HTTP prover), WASM, and
  simulator proving modes via a unified configuration.
  - Remove `withProving` / `withProvingDefaults` and the `provingService` dependency from the V1 builders in both the
    shielded and dust wallet packages. Proving is no longer a wallet-level concern.
  - Integrate the `ProvingService` into `WalletFacade`, which now owns transaction proving and finalization. On proving
    failure the facade reverts the transaction across all three wallet types (shielded, unshielded, dust).

  ### Breaking changes
  - **`@midnightntwrk/wallet-sdk-shielded`**: Removed `finalizeTransaction` from `ShieldedWalletAPI`. Removed `Proving`
    export from `@midnightntwrk/wallet-sdk-shielded/v1`. Removed `provingService` from the V1 builder and
    `RunningV1Variant.Context`. Removed `withProving` / `withProvingDefaults` from `V1Builder`. `DefaultV1Configuration`
    no longer includes `DefaultProvingConfiguration`.
  - **`@midnightntwrk/wallet-sdk-dust-wallet`**: Removed `proveTransaction` from `DustWalletAPI`. Removed
    `provingService` from the V1 builder and `RunningV1Variant.Context`. Removed `withProving` / `withProvingDefaults`
    from `V1Builder`.
  - **`@midnightntwrk/wallet-sdk-facade`**: Removed the `UnboundTransaction` type export (now re-exported from
    `@midnightntwrk/wallet-sdk-capabilities/proving`). `WalletFacade` now requires a `ProvingService` and
    `DefaultConfiguration` includes `DefaultProvingConfiguration`.

- Updated dependencies [3843720]
- Updated dependencies [6c359b8]
- Updated dependencies [7ef6ff9]
- Updated dependencies [f52d01d]
- Updated dependencies [aa7ede2]
- Updated dependencies [dd004db]
- Updated dependencies [0f29d01]
- Updated dependencies [55380e5]
- Updated dependencies [330867f]
- Updated dependencies [fe57cc3]
- Updated dependencies [cef03a5]
  - @midnightntwrk/wallet-sdk-abstractions@2.0.0
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0
  - @midnightntwrk/wallet-sdk-node-client@1.0.1
  - @midnightntwrk/wallet-sdk-prover-client@1.1.0
  - @midnightntwrk/wallet-sdk-utilities@1.0.1

## 3.1.0-rc.2

### Patch Changes

- d3422bc: - Extract proving into a standalone `ProvingService` in the `@midnightntwrk/wallet-sdk-capabilities` package,
  decoupling it from the shielded and dust wallet builders. The new service supports server (HTTP prover), WASM, and
  simulator proving modes via a unified configuration.
  - Remove `withProving` / `withProvingDefaults` and the `provingService` dependency from the V1 builders in both the
    shielded and dust wallet packages. Proving is no longer a wallet-level concern.
  - Integrate the `ProvingService` into `WalletFacade`, which now owns transaction proving and finalization. On proving
    failure the facade reverts the transaction across all three wallet types (shielded, unshielded, dust).

  ### Breaking changes
  - **`@midnightntwrk/wallet-sdk-shielded`**: Removed `finalizeTransaction` from `ShieldedWalletAPI`. Removed `Proving`
    export from `@midnightntwrk/wallet-sdk-shielded/v1`. Removed `provingService` from the V1 builder and
    `RunningV1Variant.Context`. Removed `withProving` / `withProvingDefaults` from `V1Builder`. `DefaultV1Configuration`
    no longer includes `DefaultProvingConfiguration`.
  - **`@midnightntwrk/wallet-sdk-dust-wallet`**: Removed `proveTransaction` from `DustWalletAPI`. Removed
    `provingService` from the V1 builder and `RunningV1Variant.Context`. Removed `withProving` / `withProvingDefaults`
    from `V1Builder`.
  - **`@midnightntwrk/wallet-sdk-facade`**: Removed the `UnboundTransaction` type export (now re-exported from
    `@midnightntwrk/wallet-sdk-capabilities/proving`). `WalletFacade` now requires a `ProvingService` and
    `DefaultConfiguration` includes `DefaultProvingConfiguration`.
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0-rc.2
  - @midnightntwrk/wallet-sdk-prover-client@1.1.0-rc.2

## 3.1.0-rc.1

### Patch Changes

- Updated dependencies [330867f]
  - @midnightntwrk/wallet-sdk-utilities@1.0.1-rc.0
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0-rc.1

## 3.1.0-rc.0

### Minor Changes

- f52d01d: - expose functions for reverting pending coins (booked for a pending transaction) from a provided transaction
  - extract submission into `@midnightntwrk/wallet-sdk-capabilities` package as a standalone service and integrate it
    into the `WalletFacade`
  - make `WalletFacade` revert transaction upon submission failure
  - change initialization of `WalletFacade` to a static async method `WalletFacade.init` taking a configuration object.
    This will allow non-breaking future initialization changes when e.g. new services are being integrated into the
    facade.
- f52d01d: - Create a pending transactions service in the `@midnightntwrk/wallet-sdk-capabilities` package. The service
  checks TTL and status of transactions against indexer in order to report failures. The service state is also meant to
  be serialized and restored in order to not loose track of pending transactions in case of wallet restarts
  - Integrate the pending transactions service into the `WalletFacade`. It registers transactions as soon as they are
    finalized (it can't happen earlier because unproven transactions contain copies of secret keys for proving
    purposes). Whenever a pending transaction is reported as failed - it is reverted. The pending transactions service
    state is also reported in the facade state for serialization purposes and to enable UI reporting.

### Patch Changes

- Updated dependencies [f52d01d]
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0-rc.0

## 3.0.0

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
- Updated dependencies [3f14055]
- Updated dependencies [fb55d52]
- Updated dependencies [f7aac06]
- Updated dependencies [8b8d708]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
- Updated dependencies [fb55d52]
  - @midnightntwrk/wallet-sdk-address-format@3.0.0
  - @midnightntwrk/wallet-sdk-hd@3.0.0

## 3.0.0-beta.12

### Patch Changes

- f7aac06: Update blockchain dependencies to latest versions:
  - Upgrade `@midnight-ntwrk/ledger-v7` from `7.0.0-rc.1` to `7.0.0` (stable release)
  - Update `indexer-standalone` Docker image from `3.0.0-alpha.25` to `3.0.0-rc.1`
  - Update `midnight-node` Docker image from `0.20.0-rc.1` to `0.20.0-rc.6`

- Updated dependencies [f7aac06]
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.12

## 3.0.0-beta.11

### Patch Changes

- 8b8d708: chore: update ledger to version 7.0.0-rc.1
- Updated dependencies [8b8d708]
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.11

## 3.0.0-beta.10

### Patch Changes

- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.10
  - @midnightntwrk/wallet-sdk-hd@3.0.0-beta.8

## 3.0.0-beta.9

### Patch Changes

- 3f14055: chore: bump ledger to version 6.1.0-alpha.6
- Updated dependencies [3f14055]
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.9

## 3.0.0-beta.8

### Patch Changes

- Updated dependencies [fb55d52]
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.8
  - @midnightntwrk/wallet-sdk-hd@3.0.0-beta.7

## 3.0.0-beta.7

### Patch Changes

- 1db4280: chore: bump ledger to version 6.1.0-beta.5
- Updated dependencies [1db4280]
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.7

## 3.0.0-beta.6

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure
- Updated dependencies [2a0d132]
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.6
  - @midnightntwrk/wallet-sdk-hd@3.0.0-beta.6

## 3.0.0-beta.5

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
- Updated dependencies [ae22baf]
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.5
  - @midnightntwrk/wallet-sdk-hd@3.0.0-beta.5
