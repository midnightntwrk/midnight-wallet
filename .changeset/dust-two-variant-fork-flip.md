---
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-facade': minor
'@midnightntwrk/wallet-sdk-testkit': major
---

`DustWallet(configuration)` is a two-variant, fork-crossing wallet, and `forkVersion` is required.

The shipped dust wallet now registers one variant either side of a protocol boundary — the pre-fork ledger version from
the minimum supported version, the post-fork one from `configuration.forkVersion` — and follows the chain across it.
The crossing itself is unchanged and still proven by `test/forkSimulation.test.ts`, which was rewired onto the shipped
factory with **no assertion changed**: the test-only two-variant builder it used to stand on has been dissolved into
`test/forkHarness.ts`, which is now observation and simulated infrastructure around the real wallet.

**`forkVersion` is required on `DefaultDustConfiguration`, without a default.** A wrong value does not degrade — it
decides which ledger version reads the chain. `@midnightntwrk/wallet-sdk-shielded` publishes `V9_NATIVE_FORK_VERSION`
(`2000000`, measured on a ledger-v9-native node line) for suites and applications pointed at such a chain; the field is
the same name and type the shielded configuration already required, so an application composing the facade's
configuration passes it once and nothing else changes.

What else moved:

- `DustWallet` retains **start material** rather than a raw key. A wallet started from a seed can start synchronization
  on either variant, because each derives its own `DustSecretKey` through a new per-variant `startAux` capability
  (`V1Builder`/`V2Builder` gained `withStartAux`/`withStartAuxDefaults`, and a hand-composed builder that never states
  one is now refused at `build`). A wallet started from a key object answers only for the variant that key belongs to.
- `DustWalletState` binds its projections to the variant that produced the emission (`DustWalletState.fromVariant`).
  Everything it projects is version-agnostic plain data; the version union surfaces on `state` alone. The
  `capabilities` and `services` members are **gone** — `splitNightUtxos` is now a method on the state, which is what
  the facade actually reached through them for.
- `restore` routes on the protocol version the snapshot declares (dust snapshots have always persisted it), falling
  back to the head variant for an envelope that declares none; a version no registered variant owns raises the typed
  `UnsupportedSnapshotVersionError`.
- `CustomDustWallet` is unchanged and still single-variant.

**A temporary seam, which must not survive to general availability.** While the wallet is on the pre-fork variant,
`createDustGenerationTransaction`, `attachDustRegistration`, `addDustGenerationSignature`,
`addDustRegistrationSignature`, `calculateFee`, `estimateFee` and `balanceTransactions` fail with a typed
`PreForkDustTransactingUnsupportedError`. Each of them takes or produces a transaction of the post-fork ledger version,
which this release has no way to prove; the seam closes with version-routed proving. Everything else works on both
sides: synchronization, the state observable and all its projections, `balance(date)`, dust generation estimates,
`splitNightUtxosForDustRegistration`, `revertTransaction`, addresses, serialization, restore, and the migration.

**Two consequences, both accepted and reported rather than hidden.** (1) Every start on a chain already past the
boundary pays one spurious migration: the wallet begins on the pre-fork variant, applies nothing, and hands over on its
first batch. (2) **The projections fast-sync path is unreachable through the shipped `DustWallet`.** It is a post-fork
capability — it needs `DustLocalState` APIs no published pre-fork ledger version has, permanently — so a two-variant
wallet always boots the event-replay variant and would only reach projections after migrating. Fast sync therefore
stays a **single-variant** composition (`CustomDustWallet` + `makeEventLessSyncService`, as `docs-snippets`'
`dust-fast-sync.ts` shows), which is unaffected by this change and correspondingly cannot cross a fork.

BREAKING CHANGE — `DefaultDustConfiguration` requires `forkVersion`. `DustWalletState.capabilities` and
`DustWalletState.services` are removed (use the state's own projections; `splitNightUtxos` is now a method).
`DustWalletState.state` is a union of the two variants' core states. A hand-composed `V1Builder`/`V2Builder` must call
`withStartAuxDefaults()` (or `withStartAux`). The testkit's `DustWalletConfiguration` is the dust package's own
`DefaultDustConfiguration` rather than its post-fork variant's, and its environments supply `forkVersion`.
