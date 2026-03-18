# @midnight-ntwrk/wallet-sdk-capabilities

## 3.2.0-rc.0

### Minor Changes

- aa7b1f4: chore: update ledger to v8

### Patch Changes

- Updated dependencies [9d71d25]
- Updated dependencies [ea55591]
- Updated dependencies [aa7b1f4]
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.2.0-rc.0
  - @midnight-ntwrk/wallet-sdk-utilities@1.1.0-rc.0
  - @midnight-ntwrk/wallet-sdk-prover-client@1.2.0-rc.0
  - @midnight-ntwrk/wallet-sdk-node-client@1.1.0-rc.0

## 3.1.0

### Minor Changes

- f52d01d: - expose functions for reverting pending coins (booked for a pending transaction) from a provided transaction
  - extract submission into `@midnight-ntwrk/wallet-sdk-capabilities` package as a standalone service and integrate it
    into the `WalletFacade`
  - make `WalletFacade` revert transaction upon submission failure
  - change initialization of `WalletFacade` to a static async method `WalletFacade.init` taking a configuration object.
    This will allow non-breaking future initialization changes when e.g. new services are being integrated into the
    facade.
- f52d01d: - Create a pending transactions service in the `@midnight-ntwrk/wallet-sdk-capabilities` package. The service
  checks TTL and status of transactions against indexer in order to report failures. The service state is also meant to
  be serialized and restored in order to not loose track of pending transactions in case of wallet restarts
  - Integrate the pending transactions service into the `WalletFacade`. It registers transactions as soon as they are
    finalized (it can't happen earlier because unproven transactions contain copies of secret keys for proving
    purposes). Whenever a pending transaction is reported as failed - it is reverted. The pending transactions service
    state is also reported in the facade state for serialization purposes and to enable UI reporting.

### Patch Changes

- d3422bc: - Extract proving into a standalone `ProvingService` in the `@midnight-ntwrk/wallet-sdk-capabilities`
  package, decoupling it from the shielded and dust wallet builders. The new service supports server (HTTP prover),
  WASM, and simulator proving modes via a unified configuration.
  - Remove `withProving` / `withProvingDefaults` and the `provingService` dependency from the V1 builders in both the
    shielded and dust wallet packages. Proving is no longer a wallet-level concern.
  - Integrate the `ProvingService` into `WalletFacade`, which now owns transaction proving and finalization. On proving
    failure the facade reverts the transaction across all three wallet types (shielded, unshielded, dust).

  ### Breaking changes
  - **`@midnight-ntwrk/wallet-sdk-shielded`**: Removed `finalizeTransaction` from `ShieldedWalletAPI`. Removed `Proving`
    export from `@midnight-ntwrk/wallet-sdk-shielded/v1`. Removed `provingService` from the V1 builder and
    `RunningV1Variant.Context`. Removed `withProving` / `withProvingDefaults` from `V1Builder`. `DefaultV1Configuration`
    no longer includes `DefaultProvingConfiguration`.
  - **`@midnight-ntwrk/wallet-sdk-dust-wallet`**: Removed `proveTransaction` from `DustWalletAPI`. Removed
    `provingService` from the V1 builder and `RunningV1Variant.Context`. Removed `withProving` / `withProvingDefaults`
    from `V1Builder`.
  - **`@midnight-ntwrk/wallet-sdk-facade`**: Removed the `UnboundTransaction` type export (now re-exported from
    `@midnight-ntwrk/wallet-sdk-capabilities/proving`). `WalletFacade` now requires a `ProvingService` and
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
  - @midnight-ntwrk/wallet-sdk-abstractions@2.0.0
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.1.0
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.1
  - @midnight-ntwrk/wallet-sdk-prover-client@1.1.0
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.1

## 3.1.0-rc.2

### Patch Changes

- d3422bc: - Extract proving into a standalone `ProvingService` in the `@midnight-ntwrk/wallet-sdk-capabilities`
  package, decoupling it from the shielded and dust wallet builders. The new service supports server (HTTP prover),
  WASM, and simulator proving modes via a unified configuration.
  - Remove `withProving` / `withProvingDefaults` and the `provingService` dependency from the V1 builders in both the
    shielded and dust wallet packages. Proving is no longer a wallet-level concern.
  - Integrate the `ProvingService` into `WalletFacade`, which now owns transaction proving and finalization. On proving
    failure the facade reverts the transaction across all three wallet types (shielded, unshielded, dust).

  ### Breaking changes
  - **`@midnight-ntwrk/wallet-sdk-shielded`**: Removed `finalizeTransaction` from `ShieldedWalletAPI`. Removed `Proving`
    export from `@midnight-ntwrk/wallet-sdk-shielded/v1`. Removed `provingService` from the V1 builder and
    `RunningV1Variant.Context`. Removed `withProving` / `withProvingDefaults` from `V1Builder`. `DefaultV1Configuration`
    no longer includes `DefaultProvingConfiguration`.
  - **`@midnight-ntwrk/wallet-sdk-dust-wallet`**: Removed `proveTransaction` from `DustWalletAPI`. Removed
    `provingService` from the V1 builder and `RunningV1Variant.Context`. Removed `withProving` / `withProvingDefaults`
    from `V1Builder`.
  - **`@midnight-ntwrk/wallet-sdk-facade`**: Removed the `UnboundTransaction` type export (now re-exported from
    `@midnight-ntwrk/wallet-sdk-capabilities/proving`). `WalletFacade` now requires a `ProvingService` and
    `DefaultConfiguration` includes `DefaultProvingConfiguration`.
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.1.0-rc.2
  - @midnight-ntwrk/wallet-sdk-prover-client@1.1.0-rc.2

## 3.1.0-rc.1

### Patch Changes

- Updated dependencies [330867f]
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.1-rc.0
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.1.0-rc.1

## 3.1.0-rc.0

### Minor Changes

- f52d01d: - expose functions for reverting pending coins (booked for a pending transaction) from a provided transaction
  - extract submission into `@midnight-ntwrk/wallet-sdk-capabilities` package as a standalone service and integrate it
    into the `WalletFacade`
  - make `WalletFacade` revert transaction upon submission failure
  - change initialization of `WalletFacade` to a static async method `WalletFacade.init` taking a configuration object.
    This will allow non-breaking future initialization changes when e.g. new services are being integrated into the
    facade.
- f52d01d: - Create a pending transactions service in the `@midnight-ntwrk/wallet-sdk-capabilities` package. The service
  checks TTL and status of transactions against indexer in order to report failures. The service state is also meant to
  be serialized and restored in order to not loose track of pending transactions in case of wallet restarts
  - Integrate the pending transactions service into the `WalletFacade`. It registers transactions as soon as they are
    finalized (it can't happen earlier because unproven transactions contain copies of secret keys for proving
    purposes). Whenever a pending transaction is reported as failed - it is reverted. The pending transactions service
    state is also reported in the facade state for serialization purposes and to enable UI reporting.

### Patch Changes

- Updated dependencies [f52d01d]
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.1.0-rc.0

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
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0

## 3.0.0-beta.12

### Patch Changes

- f7aac06: Update blockchain dependencies to latest versions:
  - Upgrade `@midnight-ntwrk/ledger-v7` from `7.0.0-rc.1` to `7.0.0` (stable release)
  - Update `indexer-standalone` Docker image from `3.0.0-alpha.25` to `3.0.0-rc.1`
  - Update `midnight-node` Docker image from `0.20.0-rc.1` to `0.20.0-rc.6`

- Updated dependencies [f7aac06]
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.12

## 3.0.0-beta.11

### Patch Changes

- 8b8d708: chore: update ledger to version 7.0.0-rc.1
- Updated dependencies [8b8d708]
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.11

## 3.0.0-beta.10

### Patch Changes

- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.8

## 3.0.0-beta.9

### Patch Changes

- 3f14055: chore: bump ledger to version 6.1.0-alpha.6
- Updated dependencies [3f14055]
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.9

## 3.0.0-beta.8

### Patch Changes

- Updated dependencies [fb55d52]
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.7

## 3.0.0-beta.7

### Patch Changes

- 1db4280: chore: bump ledger to version 6.1.0-beta.5
- Updated dependencies [1db4280]
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.7

## 3.0.0-beta.6

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure
- Updated dependencies [2a0d132]
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.6

## 3.0.0-beta.5

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
- Updated dependencies [ae22baf]
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.5
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.5
