# @midnightntwrk/wallet-sdk-testkit

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
