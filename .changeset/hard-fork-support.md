---
'@midnightntwrk/wallet-sdk-abstractions': major
'@midnightntwrk/wallet-sdk-address-format': minor
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk-hd': minor
'@midnightntwrk/wallet-sdk-indexer-client': minor
'@midnightntwrk/wallet-sdk-node-client': minor
'@midnightntwrk/wallet-sdk-prover-client': minor
'@midnightntwrk/wallet-sdk-runtime': minor
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-testkit': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-utilities': patch
'@midnightntwrk/wallet-sdk': major
---

Hard-fork support. A wallet runs the pre-fork ledger (`@midnight-ntwrk/ledger-v8`) below the chain's fork version and
the current ledger (`@midnightntwrk/ledger-v9`) from it, and follows a live chain across the boundary: balances, coins
and transaction history survive the crossing, and a wallet restored from a pre-fork snapshot crosses too. Applications
no longer import a ledger package.

### Breaking: configuration and starting

- `forks.v9` is required in the shielded, dust, unshielded and facade configurations: the protocol version at which
  the chain switches ledgers. There is no default. `ProtocolVersion.V9NativeForkVersion`, from the abstractions package, is
  the value a 2.x chain reports (2000000); the final mainnet constant is not fixed yet, so supply it per environment.
- `chainVersionProbe` is a new optional setting on all three wallets. By default a wallet asks the indexer, on every
  start, which protocol version the chain's first block was produced under, with a 5-second timeout, and starts on the
  matching side. A failed probe never fails a start: the wallet starts pre-fork and crosses on its first synced update.
  A custom probe must answer the same question.
- Wallets start from seeds. On `ShieldedWallet(...)` and `DustWallet(...)`, `startWithSecretKeys` and
  `startWithSecretKey` are removed; `startWithSeed(seed)` and `startWithKeys({ v8, v9 })` replace them and return a
  `Promise`. The unshielded `startWithPublicKey` also returns a `Promise` now. The single-variant `CustomShieldedWallet`
  and `CustomDustWallet` keep their synchronous starts and cannot cross a fork. The instance method `start(secretKeys)`
  stays and is right for a wallet restored at or past the fork.
- Dust parameters are optional. `DustWallet(...).startWithSeed(seed, dustParameters?)` and
  `DefaultDustConfiguration.dustParameters` take a plain `DustGenerationRates` object and default to the ledger's initial
  parameters.
- The facade starts from `WalletSeeds.fromMasterSeed(masterSeed)` or from `FacadeKeysByEpoch`
  (`{ v8: { shielded, dust }, v9: { shielded, dust } }`). Its third `start` argument is now an options object
  (`{ manualSync?: boolean }`), and `doSync` takes the same start material as `start`.
- The `secretKeys` parameter is gone from every transaction-building method. A stopped wallet drops its key material;
  transacting after `stop()` fails with `MissingStartAuxError`.

### Breaking: transactions carry the version that built them

- Every facade and wallet method that took or returned a ledger transaction now uses `WalletTransaction`, a handle that
  records the protocol version the transaction was built for. A handle from the other side of the fork is refused with
  `ProtocolVersionMismatchError`, which names the version in `authoredFor`. Applications that build their own transactions
  import `@midnightntwrk/wallet-sdk/ledger/v8` or `/ledger/v9` (not re-exported from the root) and seal the result with
  `WalletTransaction.adopt('Unproven', tx, protocolVersion)`. Handles serialize with `toWire` and `fromWire`. Authoring
  against `/ledger/v9` on a chain that has not crossed compiles and fails at run time.
- `FacadeState.pending` is now an array of `{ transaction, submittedAt, authoredFor, status }`; the pending-set object
  it used to be is gone. `status` is `Submitted`, `Confirmed`, `Rejected` or `Orphaned` (`{ authoredFor, chainNow }`).
  A transaction still pending at the fork is orphaned: it can never be included, so its coins are released and history
  records the rejection with reason `orphaned-by-protocol-upgrade`. `revert` and `revertTransaction` accept an optional
  reason. The unshielded `revertTransaction` ignores a handle from the other side of the fork.
- Facade recipes (`FinalizedTransactionRecipe`, `UnboundTransactionRecipe`, `UnprovenTransactionRecipe`) gain a required
  `protocolVersion`, and `BlockData` gains a required `protocolVersion`.
- Proving, validation and block ledger-parameter reads route on the transaction's version. Configure proof servers as
  `provingServers: [{ sinceVersion, url }]`; `provingServerUrl` remains for a single server. Both fields of
  `DefaultProvingConfiguration` are optional and a configuration with neither fails with `ProvingConfigurationError`.
  `defaultLedgerParametersCodecs(forkVersion)` is the version-routed codec set.

### Breaking: the wallet packages' root API

- `ShieldedWalletState`, `DustWalletState` and `UnshieldedWalletState` lose their `capabilities` and `services` fields
  and the static `mapState`; `fromVariant` replaces it and the constructor is `(protocolVersion, state, projections)`.
  Their `state` is a union of the pre-fork and current core state. The unshielded `UnshieldedWalletCapabilities` and
  `UnshieldedWalletServices` types are deleted. Shielded `BalancingResult` is renamed `ShieldedBalancingResult`.
- `DefaultShieldedConfiguration`, `DefaultDustConfiguration` and `DefaultUnshieldedConfiguration` are declared by each
  package rather than aliased to a variant's; the testkit's configuration types follow.
- The `./v1` subpath of each wallet package, and `shielded/v1`, `dust/v1`, `unshielded/v1` in `@midnightntwrk/wallet-sdk`,
  now export the pre-fork ledger-v8 wallet. The ledger-v9 wallet moved to `./v2` with `V1`-named exports renamed to
  `V2`. `./v1` is not a plain copy: the dust `./v1` has no projections-based fast sync (it rests on ledger-v9 APIs);
  the unshielded `./v1` has its own `createKeystore` whose secret is a plain `Uint8Array`, no ECDSA, and no
  `SchemeMismatchError`; `Simulator` on `./v1` is the ledger-v8 simulator only. Both subpaths gain a `Migration`
  namespace, and their builders gain `withStartAux`, `withStartAuxDefaults`, `withMigration` and
  `withMigrationDefaults`.
- Root entry points keep their names and gain the forking wallet types, `ProtocolVersion.V9NativeForkVersion`, `DustGenerationRates`
  with `asPreForkDustParameters` and `asPostForkDustParameters`, and snapshot inspection: `Restore` (shielded) and
  `UnshieldedRestore` namespaces, and the dust `peekProtocolVersion` and `UnsupportedSnapshotVersionError`.
- Existing snapshots restore; `restore` and the new `tryRestore` route on the protocol version a snapshot declares, and
  `tryRestore` returns the reason a snapshot cannot be read instead of throwing. Shielded snapshots written mid-crossing
  carry `coinHashesPending`, and pending-transaction entries now record their protocol version.
- Sync types: the shielded and dust `WalletSyncUpdate` are tagged unions on `_tag`, the unshielded one is discriminated on
  `type` (its indexer-decoded shape is exported as `IndexerSyncUpdate`), and all three gain a `VersionSignal` member.
  Shielded and dust event schemas deliver events as raw hex, decoded by the variant that applies them; the unshielded
  progress frame requires `protocolVersion`. Custom sync capabilities receive the protocol-version range they own as a
  third `applyUpdate` argument and must leave updates at or beyond it unapplied. Exported helpers implement the rule;
  ignoring the argument keeps the old behaviour.

### Breaking: runtime, capabilities and abstractions

For code that composes wallets or test fixtures by hand.

- Abstractions: `ProtocolState` requires a `variantTag` and `getEquivalence` compares it. `ProtocolVersion.Registry`
  (`makeRegistry`, `makeRegistryFromActivations`, `select`, `selectEntry`) picks the implementation for a protocol
  version; `ProtocolVersion.epochOf` says which side of a fork a version is on. New errors `RegistryError` and
  `InvalidTokenTypeError`.
- Runtime: `Variant.migrateState` may fail with `WalletRuntimeError`. `withVariant(sinceVersion, builder, configuration?)`
  accepts a per-variant configuration. `VariantContext.activationRange` carries the variant's version range and
  `Runtime.onVariantActivation` fires when a migration activates one. New `StartMaterial` module, `RuntimeState`,
  `variantFor` and `startAtVariant`.
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
  (`LedgerStateTranslator`, `translatorFromAsync`, `unavailableTranslator`). Simulators gain a protocol-version timeline:
  `SimulatorConfig.protocolVersion`, `setProtocolVersion`, `scheduleFork`, `produceEmptyBlock`, and `protocolVersion`
  on blocks.
- Indexer client: `protocolVersion` is read on `BlockHash`, `DustLedgerEvents`, `DustNullifierTransactions` and the
  unshielded progress frame. New id-only subscriptions `ZswapEventTip` and `DustLedgerEventTip`.
- HD: `WalletSeeds.fromMasterSeed(masterSeed, { account?, addressIndex?, unshieldedRole? })` derives the three per-wallet
  seeds at `m/44'/2400'/account'/role/index` (roles 0 unshielded, 2 dust, 3 shielded; `Roles.EcdsaUnshielded` for an
  ECDSA unshielded identity), throws `SeedDerivationError`, and is specified with test vectors in the wallet
  specification.
- Umbrella: new subpath `capabilities/codecs`; the root exports `Token.night`, `parseTokenType`, `Signing` and
  `UnsupportedSignatureKindError`, so token types and signatures need no ledger import.

### Behaviour at the fork

- `FacadeState.protocolVersion`, `activeProtocolVersion` and `protocol` report where the wallets are: `Settled`
  (`{ version }`) or `Crossing` (`{ from, to, behind }`).
- The shielded wallet carries its local state across as bytes, coins at their positions in the commitment tree. Coin
  commitments and nullifiers need keys a migration lacks, so they are computed on the first synced update after the
  crossing; until then `balances`, `availableCoins` and `pendingCoins` read empty, and a snapshot written in that window
  restores. The dust wallet starts empty and rebuilds from the chain, which wipes and replays dust at the fork.
  Unshielded state is copied field by field; UTxOs booked by transactions still pending at the fork return to the
  available balance. After a migration each wallet restarts its own sync; `stop` prevents a late restart.
- Wallet state records the protocol version the indexer reports and it only ever increases, so replayed history cannot
  drag a wallet back across the boundary.
- A wallet with no traffic of its own still notices the fork. The unshielded wallet reads the version off its progress
  frames and adopts it once caught up to the frame's highest transaction id. Shielded and dust re-ask the chain's tip on a
  timer (`DefaultSyncConfiguration.versionWatch.intervalMs`, default 30 s, zero or less disables), and record it only
  once level with the far end of their own event timeline, so a hand-over never outruns unread history.
- Carried Night UTxOs cross with `registeredForDustGeneration: false`, matching what the indexer reports after the fork,
  so re-registering for dust generation post-fork funds its own fee. `claimableFeePayment(dustState, nightUtxos, now)` is
  exported for callers that want the amount `waitForGeneratedDust` waits on.
- Known limitations: shielded spends pending at the fork stay locked afterwards until the ledger offers a way to clear
  them; the dust projections-based fast sync does not hand over at a fork on its own (only relevant at a future fork) and
  now logs its resume cursors at debug level; a fresh dust wallet on a chain that forked over history replays the
  pre-fork dust events before crossing.

### Dependencies

- `@midnightntwrk/ledger-v9` `1.0.0-rc.4`. Its dust spend circuit differs from rc.3, so an rc.4 chain rejects proofs from
  a proof server built for rc.3. Proof-server image tags do not track ledger tags: run `9.0.0-rc.7`, the build the rc.4
  ledger declares. The `./testing` containers in `@midnightntwrk/wallet-sdk-utilities` default to it.
- `@midnight-ntwrk/ledger-v8` is now a runtime dependency of the capabilities, wallet, facade, testkit and umbrella
  packages, so browser bundles load two ledger WASM modules.
