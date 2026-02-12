# @midnight-ntwrk/wallet-sdk-dust-wallet

## 2.0.0-rc.1

### Patch Changes

- Updated dependencies [3843720]
- Updated dependencies [330867f]
- Updated dependencies [fe57cc3]
  - @midnight-ntwrk/wallet-sdk-abstractions@2.0.0-rc.0
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.1-rc.0
  - @midnight-ntwrk/wallet-sdk-shielded@2.0.0-rc.1
  - @midnight-ntwrk/wallet-sdk-prover-client@1.1.0-rc.1
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.1.0-rc.1
  - @midnight-ntwrk/wallet-sdk-capabilities@3.1.0-rc.1

## 2.0.0-rc.0

### Major Changes

- f52d01d: - expose functions for reverting pending coins (booked for a pending transaction) from a provided transaction
  - extract submission into `@midnight-ntwrk/wallet-sdk-capabilities` package as a standalone service and integrate it
    into the `WalletFacade`
  - make `WalletFacade` revert transaction upon submission failure
  - change initialization of `WalletFacade` to a static async method `WalletFacade.init` taking a configuration object.
    This will allow non-breaking future initialization changes when e.g. new services are being integrated into the
    facade.
- 1409b6b: Standardize wallet APIs across shielded, unshielded, and dust wallets

  ### Breaking Changes

  **Dust Wallet:**
  - Rename `DustCoreWallet` to `CoreWallet` for consistency
  - Rename `walletBalance()` to `balance()` on `DustWalletState`
  - Rename `dustPublicKey` to `publicKey` and `dustAddress` to `address` on state objects
  - Rename `getDustPublicKey()` to `getPublicKey()` and `getDustAddress()` to `getAddress()` on `KeysCapability`
  - Add `getAddress(): Promise<DustAddress>` method to `DustWalletAPI`
  - Change `dustReceiverAddress` parameter type from `string` to `DustAddress` in transaction methods

  **Shielded Wallet:**
  - Rename `startWithShieldedSeed()` to `startWithSeed()` for consistency
  - Add `getAddress(): Promise<ShieldedAddress>` method
  - Change `receiverAddress` parameter type from `string` to `ShieldedAddress` in transfer methods
  - Transaction history getter now throws "not yet implemented" error

  **Facade:**
  - `TokenTransfer` interface now requires typed addresses (`ShieldedAddress` or `UnshieldedAddress`) instead of strings
  - Split `CombinedTokenTransfer` into `ShieldedTokenTransfer` and `UnshieldedTokenTransfer` types
  - Address encoding/decoding is now handled internally - consumers pass address objects directly

  ### Migration Guide

  **Before:**

  ```typescript
  const address = MidnightBech32m.encode('undeployed', state.shielded.address).toString();
  wallet.transferTransaction([{ type: 'shielded', outputs: [{ receiverAddress: address, ... }] }]);
  ```

  **After:**

  ```typescript
  const address = await wallet.shielded.getAddress();
  wallet.transferTransaction([{ type: 'shielded', outputs: [{ receiverAddress: address, ... }] }]);
  ```

### Patch Changes

- aa7ede2: ## Added
  - Implemented WebAssembly (WASM) proving provider as an alternative to server-based proving
  - Added `ProverClient.WasmConfig` interface for WASM prover configuration
  - Introduced Web Worker-based proof generation with message-based communication
  - Added comprehensive test coverage for both server and WASM proving services

  ## Changed
  - Updated proving interface to support custom key material providers
  - Migrated from Filecoin keys to Midnight-specific keys in Wasm prover

  ## Internal
  - Refactored test utilities to support multiple proving backends

- Updated dependencies [f52d01d]
- Updated dependencies [f52d01d]
- Updated dependencies [aa7ede2]
- Updated dependencies [1409b6b]
  - @midnight-ntwrk/wallet-sdk-shielded@2.0.0-rc.0
  - @midnight-ntwrk/wallet-sdk-capabilities@3.1.0-rc.0
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.1.0-rc.0
  - @midnight-ntwrk/wallet-sdk-prover-client@1.1.0-rc.0

## 1.0.0

### Patch Changes

- 3f14055: chore: bump ledger to version 6.1.0-alpha.6
- fb55d52: Introduce more convenient API for Bech32m address encoding/decoding Remove network id from Dust wallet
  initialization methods (so they are read from the configuration) Introduce FacadeState and add a getter to check for
  sync status of whole facade wallet Introduce CompositeDerivation for HD wallet, so that it is possible to derive keys
  for multiple roles at once
- eec1ddb: feat: rewrite balancing recipes
- f7aac06: Update blockchain dependencies to latest versions:
  - Upgrade `@midnight-ntwrk/ledger-v7` from `7.0.0-rc.1` to `7.0.0` (stable release)
  - Update `indexer-standalone` Docker image from `3.0.0-alpha.25` to `3.0.0-rc.1`
  - Update `midnight-node` Docker image from `0.20.0-rc.1` to `0.20.0-rc.6`

- fb55d52: chore: remove wallet api dep from dust wallet
- aef8d4b: Performance improvement: Shielded and Dust wallet now send events in batches of 50 or after 10 seconds if
  total events has not reached 50
- 8b8d708: chore: update ledger to version 7.0.0-rc.1
- fb55d52: chore: initialize baseline release after introducing Changesets
- fb55d52: chore: force re-release after workspace failure
- aa3c5d7: Batch events for processing for better responsiveness and performance
- a768341: Use fallible section to enable usage of more than 1 pair of Night input/output
- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs
- fb55d52: chore: bump ledger to version 6.1.0-beta.5
- Updated dependencies [3f14055]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
- Updated dependencies [eec1ddb]
- Updated dependencies [94a39ef]
- Updated dependencies [f7aac06]
- Updated dependencies [a06ccf3]
- Updated dependencies [aef8d4b]
- Updated dependencies [8b8d708]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
- Updated dependencies [aa3c5d7]
- Updated dependencies [fb55d52]
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
- Updated dependencies [b9865cf]
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0

## 1.0.0-beta.16

### Patch Changes

- f7aac06: Update blockchain dependencies to latest versions:
  - Upgrade `@midnight-ntwrk/ledger-v7` from `7.0.0-rc.1` to `7.0.0` (stable release)
  - Update `indexer-standalone` Docker image from `3.0.0-alpha.25` to `3.0.0-rc.1`
  - Update `midnight-node` Docker image from `0.20.0-rc.1` to `0.20.0-rc.6`

- Updated dependencies [f7aac06]
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.17
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.12
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.14
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.12
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0-beta.13
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.17

## 1.0.0-beta.15

### Patch Changes

- eec1ddb: feat: rewrite balancing recipes
- aa3c5d7: Batch events for processing for better responsiveness and performance
- a768341: Use fallible section to enable usage of more than 1 pair of Night input/output
- Updated dependencies [eec1ddb]
- Updated dependencies [aa3c5d7]
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.16

## 1.0.0-beta.14

### Patch Changes

- 8b8d708: chore: update ledger to version 7.0.0-rc.1
- Updated dependencies [8b8d708]
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.15
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.13
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0-beta.12
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.16

## 1.0.0-beta.13

### Patch Changes

- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs
- Updated dependencies [94a39ef]
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.15
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.14
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.12
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.8

## 1.0.0-beta.12

### Patch Changes

- aef8d4b: Performance improvement: Shielded and Dust wallet now send events in batches of 50 or after 10 seconds if
  total events has not reached 50
- Updated dependencies [aef8d4b]
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.13
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.14

## 1.0.0-beta.11

### Patch Changes

- Updated dependencies [b9865cf]
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.13
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.12

## 1.0.0-beta.10

### Patch Changes

- 3f14055: chore: bump ledger to version 6.1.0-alpha.6
- Updated dependencies [3f14055]
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0-beta.10

## 1.0.0-beta.9

### Patch Changes

- fb55d52: Introduce more convenient API for Bech32m address encoding/decoding Remove network id from Dust wallet
  initialization methods (so they are read from the configuration) Introduce FacadeState and add a getter to check for
  sync status of whole facade wallet Introduce CompositeDerivation for HD wallet, so that it is possible to derive keys
  for multiple roles at once
- Updated dependencies [fb55d52]
- Updated dependencies [a06ccf3]
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.12
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.9

## 1.0.0-beta.8

### Patch Changes

- f967d17: chore: remove wallet api dep from dust wallet
- 1db4280: chore: bump ledger to version 6.1.0-beta.5
- Updated dependencies [976628a]
- Updated dependencies [0838f04]
- Updated dependencies [f6618f1]
- Updated dependencies [1db4280]
- Updated dependencies [646c8df]
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0-beta.9

## 1.0.0-beta.7

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure
- Updated dependencies [2a0d132]
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.6

## 1.0.0-beta.6

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
- Updated dependencies [ae22baf]
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.5
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.5
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.5
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.5
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.7
