# @midnight-ntwrk/wallet-sdk

## 2.0.0-beta.0

### Major Changes

- ce4cd19: Migrate from `@midnight-ntwrk/ledger-v8` to `@midnight-ntwrk/ledger-v9`.

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

  Consumers must resolve `@midnight-ntwrk/ledger-v9` instead of `@midnight-ntwrk/ledger-v8`.

### Patch Changes

- Updated dependencies [ce4cd19]
- Updated dependencies [dff5706]
- Updated dependencies [7111b55]
- Updated dependencies [e0097fc]
- Updated dependencies [ce4cd19]
  - @midnight-ntwrk/wallet-sdk-hd@3.1.0-beta.0
  - @midnight-ntwrk/wallet-sdk-dust-wallet@5.0.0-beta.0
  - @midnight-ntwrk/wallet-sdk-facade@5.0.0-beta.0
  - @midnight-ntwrk/wallet-sdk-prover-client@2.0.0-beta.0
  - @midnight-ntwrk/wallet-sdk-address-format@4.0.0-beta.0
  - @midnight-ntwrk/wallet-sdk-capabilities@4.0.0-beta.0
  - @midnight-ntwrk/wallet-sdk-node-client@2.0.0-beta.0
  - @midnight-ntwrk/wallet-sdk-shielded@4.0.0-beta.0
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@4.0.0-beta.0

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
  - @midnight-ntwrk/wallet-sdk-dust-wallet@4.1.0
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@3.1.0
  - @midnight-ntwrk/wallet-sdk-utilities@1.2.0
  - @midnight-ntwrk/wallet-sdk-facade@4.0.1
  - @midnight-ntwrk/wallet-sdk-address-format@3.1.2
  - @midnight-ntwrk/wallet-sdk-capabilities@3.3.1
  - @midnight-ntwrk/wallet-sdk-node-client@1.1.2
  - @midnight-ntwrk/wallet-sdk-prover-client@1.2.2
  - @midnight-ntwrk/wallet-sdk-shielded@3.0.1
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.2.2
  - @midnight-ntwrk/wallet-sdk-runtime@1.0.4

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
  - @midnight-ntwrk/wallet-sdk-capabilities@3.3.0
  - @midnight-ntwrk/wallet-sdk-facade@4.0.0
  - @midnight-ntwrk/wallet-sdk-dust-wallet@4.0.0
  - @midnight-ntwrk/wallet-sdk-shielded@3.0.0
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@3.0.0
  - @midnight-ntwrk/wallet-sdk-abstractions@2.1.0
  - @midnight-ntwrk/wallet-sdk-address-format@3.1.1
  - @midnight-ntwrk/wallet-sdk-utilities@1.1.1
  - @midnight-ntwrk/wallet-sdk-hd@3.0.2
