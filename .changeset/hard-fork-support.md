---
'@midnightntwrk/wallet-sdk-abstractions': minor
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
'@midnightntwrk/wallet-sdk': major
---

Hard-fork support. A wallet runs the pre-fork ledger (`@midnight-ntwrk/ledger-v8`) below the chain's fork version and
the current ledger (`@midnightntwrk/ledger-v9`) from it, and follows a live chain across the boundary: balances, coins
and transaction history survive the crossing, and a wallet restored from a pre-fork snapshot crosses too. Applications
no longer import a ledger package.

**Breaking**

- `forkVersion` is required in the shielded, dust, unshielded and facade configurations: the protocol version at which
  the chain switches ledgers. It is a property of the chain, so there is no default.
- Wallets start from seeds. `startWithSecretKeys` and `startWithSecretKey` are removed. Use `startWithSeed`,
  `WalletFacade.start(seeds)` with `WalletSeeds.fromMasterSeed`, or `startWithKeys` with key objects for both ledger
  versions. Starting is asynchronous and returns a `Promise`.
- The `secretKeys` parameter is gone from every transaction-building method.
- Facade methods take and return `WalletTransaction`, a handle that records the protocol version the transaction was
  built for. A handle from the other side of the fork is refused with `ProtocolVersionMismatchError`. Applications that
  build their own transactions import `@midnightntwrk/wallet-sdk/ledger/v8` or `/ledger/v9` and wrap the result with
  `WalletTransaction.adopt`.
- `FacadeState.pending` entries carry a status: `Submitted`, `Confirmed`, `Rejected` or `Orphaned`. A transaction still
  pending at the fork is orphaned: it can never be included, so its coins are released and history records why.
- Proof servers are configured per version with `provingServers: [{ sinceVersion, url }]`; `provingServerUrl` remains
  for a single server. `defaultLedgerParametersCodecs` takes the fork version.
- The `./v1` subpaths of the three wallet packages, and `shielded/v1`, `dust/v1` and `unshielded/v1` in
  `@midnightntwrk/wallet-sdk`, now export the pre-fork ledger-v8 wallet. The ledger-v9 wallet moved to `./v2`, with
  `V1`-named exports renamed to `V2`. Root entry points and serialized wallet state are unchanged.
- For code that composes wallets or test fixtures by hand: `ProtocolState` requires a `variantTag`, builder chains
  require `withStartAux`, custom sync capabilities receive the protocol-version range they own in `applyUpdate`, sync
  schemas deliver events as raw hex, and the testkit helpers take seeds and a fork version. `currentChainVersion` is
  renamed `timelineStartChainVersion` and `LatestBlockAnswer` is renamed `BlockVersionAnswer`.

**Added**

- `ProtocolVersion.Registry` picks the implementation for a protocol version.
- `FacadeState.protocolVersion`, `activeProtocolVersion` and `protocol`, which reports `Settled` or `Crossing`.
- `WalletSeeds.fromMasterSeed`: the specified derivation from one master seed to the three per-wallet seeds, with test
  vectors in the wallet specification.
- `Token.night`, `parseTokenType` and the `Signing` types from the umbrella package root, so token types and signatures
  need no ledger import.
- `tryRestore` beside `restore` on all three wallets, returning the reason a snapshot cannot be read.
- `startWithSeed` and `startWithKeys({ v8, v9 })` on restored shielded and dust wallets.
- `DefaultSyncConfiguration.versionWatch.intervalMs` (default 30 s, 0 disables): how often a shielded or dust wallet
  with no traffic of its own checks the chain's protocol version. The unshielded wallet takes it from its progress
  frames. All three `WalletSyncUpdate` types gain a `VersionSignal` member.
- Indexer client subscriptions `ZswapEventTip` and `DustLedgerEventTip`.
- `claimableFeePayment(dustState, nightUtxos, now)` from the dust wallet.
- Simulators per ledger version (`V8`, `V9`) and a `ForkSimulator` in the capabilities `simulation` entry point, with
  the runtime hooks they rest on (`VariantContext.activationRange`, `Runtime.onVariantActivation`).

**Behaviour at the fork**

- Unshielded UTxOs booked by transactions still pending at the fork return to the available balance at the crossing.
  Shielded pending spends stay locked after the fork until the ledger offers a way to clear them.
- Carried Night UTxOs cross with `registeredForDustGeneration: false`, matching what the indexer reports after the
  fork, so re-registering for dust generation post-fork funds its own fee.
- A wallet with no snapshot starts on the protocol version of the chain's first block, so it can read pre-fork history
  and cross. A chain on the current ledger since genesis starts directly on it.
- The dust wallet's projections-based fast sync does not hand over at a fork on its own. This matters only at a future
  fork. It now logs its resume cursors at debug level.

**Dependencies**

- `@midnightntwrk/ledger-v9` `1.0.0-rc.4`. Its dust spend circuit differs from rc.3, so proofs from a proof server
  built for rc.3 are rejected; run a proof server that matches the ledger line.
- `@midnight-ntwrk/ledger-v8` is now a runtime dependency of the capabilities and wallet packages, so browser bundles
  load two ledger WASM modules.
