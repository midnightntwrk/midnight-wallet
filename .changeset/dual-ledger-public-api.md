---
'@midnightntwrk/wallet-sdk-abstractions': minor
'@midnightntwrk/wallet-sdk-runtime': minor
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-indexer-client': minor
'@midnightntwrk/wallet-sdk-hd': minor
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk': major
'@midnightntwrk/wallet-sdk-testkit': major
---

The public API for the dual-ledger wallets: one wallet runs the pre-fork ledger below `forkVersion` and the current
ledger from it, and applications no longer import a ledger package.

**Breaking — configuration and starting:**

- `forkVersion` is required on the shielded, dust, unshielded and facade configurations: the protocol version at which
  the chain hands over between ledger versions. It is a property of the chain, so the SDK cannot default it.
- Wallets start from seeds. `ShieldedWallet(...).startWithSecretKeys` and `DustWallet(...).startWithSecretKey` are
  deleted with no shim; use `startWithSeed` (or `WalletFacade.start(seeds)` with `WalletSeeds.fromMasterSeed`), or
  `startWithKeys` with key objects for both ledger versions. A seed is the only key material valid on both sides of a
  boundary.
- Starts are asynchronous and return a `Promise`: a wallet first asks the chain which protocol version its timeline
  starts under — where its unread history begins — and starts on the matching variant. A failed probe never fails a
  start; the wallet then starts pre-fork and migrates on the first synced update.
- The `secretKeys` parameter is gone from every transaction-building method; the active variant derives what it needs
  from what the wallet was started with.

**Breaking — transactions carry the version that built them:**

- Every facade method that took or returned a ledger transaction now speaks `WalletTransaction`: an opaque handle that
  records the protocol version its transaction was built for. A handle from the other side of the boundary is refused
  with `ProtocolVersionMismatchError`. Applications that author transactions themselves import
  `@midnightntwrk/wallet-sdk/ledger/v8` or `/ledger/v9` and seal the result with `WalletTransaction.adopt`.
- `FacadeState.pending` is now a list of entries with a tagged status — `Submitted`, `Confirmed`, `Rejected` or
  `Orphaned`. An orphaned transaction is one a fork left behind: its bytes can never be included post-fork, so the
  wallet gives up on it immediately, releases its coins, and records the reason in transaction history.
- Proving routes on the transaction's own version: configure `provingServers` as `{ sinceVersion, url }` entries
  (`provingServerUrl` remains as the single-server form). Validation and block ledger-parameter reads route the same
  way, and `defaultLedgerParametersCodecs` is now a function of the fork version.

**Breaking — for code that composes wallets or test fixtures by hand:** `ProtocolState` values require a `variantTag`;
hand-built variant builder chains require `withStartAux`; the `Default*Configuration` types are declared per package
rather than aliased to a variant's; sync schemas deliver events as raw hex, deserialized only by the variant that
applies them; the testkit's helpers take seeds and a fork version.

**Added:**

- `ProtocolVersion.Registry` — one primitive for "pick the implementation for this protocol version", used alike by
  variants, codecs, proving, validation and pending transactions.
- `FacadeState.protocolVersion`, `activeProtocolVersion` and `protocol` — a `Settled` / `Crossing` reading of whether
  the three wallets sit on one side of the boundary or are still crossing it.
- `Token.night` and `parseTokenType` — token types without importing a ledger — and `Signing` types in the current
  ledger's shape, lowered automatically for the pre-fork variant. Both reach an application through the umbrella
  package's root; `Signing` lives beside that lowering, in `@midnightntwrk/wallet-sdk-capabilities/signatures`.
- `WalletSeeds.fromMasterSeed(masterSeed, options?)` — the specified derivation from one master seed to the three
  per-wallet seeds, with test vectors in the wallet specification.
- `tryRestore` beside `restore` on all three wallets, returning the reason a snapshot cannot be read instead of
  throwing; restoring routes on the protocol version the snapshot declares.
