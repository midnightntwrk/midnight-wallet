# @midnight-ntwrk/wallet-sdk-facade

## 4.0.0

### Major Changes

- 3763803: Add txHistory functionality to the dust wallet
- 7f82432: Introduce a shared transaction history storage layer with support for wallet-specific augmentation.
  Reimplement shielded wallet transaction history and refactor unshielded wallet transaction history to use the new
  shared storage.

### Minor Changes

- e57a94b: Unify Simulator into capabilities package with proper fee payment and block production model

### Patch Changes

- c1ae369: Fix transaction history race condition by consolidating merge logic in the facade and delegating it to
  storage at construction time.
- 8383f7b: Remove the double exporting of TransactionHistory.js
- 0db3290: chore: bump ledger version to 8.0.3
- aaa0bf1: In certain cases valid transactions won't contain any intents, which would cause the
  `WalletFacade.prototype.signRecipe` fail. Now it won't fail and return same recipe
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
  - @midnight-ntwrk/wallet-sdk-dust-wallet@4.0.0
  - @midnight-ntwrk/wallet-sdk-shielded@3.0.0
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@3.0.0
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.2.1
  - @midnight-ntwrk/wallet-sdk-address-format@3.1.1

## 3.0.0

### Major Changes

- 07ea767: fix: dynamic fee calculation including balancing transaction costs
  - Split `calculateFee` into two methods:
    - `calculateFee` — estimates the fee for a given transaction only (no balancing transaction costs)
    - `estimateFee` — calculates the total fee including the balancing transaction, requiring a secret key, wallet
      state, and TTL
  - Updated `WalletFacade` to expose `calculateTransactionFee` and an updated `estimateTransactionFee` that accepts a
    secret key and optional TTL/currentTime
  - Removed fee overhead constant; fees are now dynamically calculated based on actual coin selection
  - Updated `CoinSelection` type to return a single coin (smallest available) instead of multiple coins summed to a
    target amount
  - Added `InsufficientFundsError` to `WalletError` for cases where balancing cannot cover the fee

### Minor Changes

- aa7b1f4: chore: update ledger to v8

### Patch Changes

- 9d71d25: feat: expose Terms and Conditions via `WalletFacade.fetchTermsAndConditions`

  Adds a new `FetchTermsAndConditions` GraphQL query to `@midnight-ntwrk/wallet-sdk-indexer-client` that retrieves the
  current Terms and Conditions (URL and SHA-256 hash) from the network indexer.

  Exposes a new static method `WalletFacade.fetchTermsAndConditions(configuration)` in
  `@midnight-ntwrk/wallet-sdk-facade` that wallet builders can call before or independently of wallet initialization to
  obtain the T&C URL for display and the hash for content verification. The method accepts any configuration that
  includes `indexerClientConnection.indexerHttpUrl`, so the shared wallet configuration can be passed directly without
  adaptation.

- Updated dependencies [9d71d25]
- Updated dependencies [372d964]
- Updated dependencies [aa7b1f4]
- Updated dependencies [1ad34a9]
- Updated dependencies [07ea767]
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.2.0
  - @midnight-ntwrk/wallet-sdk-dust-wallet@3.0.0
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@2.1.0
  - @midnight-ntwrk/wallet-sdk-shielded@2.1.0
  - @midnight-ntwrk/wallet-sdk-address-format@3.1.0
  - @midnight-ntwrk/wallet-sdk-capabilities@3.2.0

## 3.0.0-rc.0

### Major Changes

- 07ea767: fix: dynamic fee calculation including balancing transaction costs
  - Split `calculateFee` into two methods:
    - `calculateFee` — estimates the fee for a given transaction only (no balancing transaction costs)
    - `estimateFee` — calculates the total fee including the balancing transaction, requiring a secret key, wallet
      state, and TTL
  - Updated `WalletFacade` to expose `calculateTransactionFee` and an updated `estimateTransactionFee` that accepts a
    secret key and optional TTL/currentTime
  - Removed fee overhead constant; fees are now dynamically calculated based on actual coin selection
  - Updated `CoinSelection` type to return a single coin (smallest available) instead of multiple coins summed to a
    target amount
  - Added `InsufficientFundsError` to `WalletError` for cases where balancing cannot cover the fee

### Minor Changes

- aa7b1f4: chore: update ledger to v8

### Patch Changes

- 9d71d25: feat: expose Terms and Conditions via `WalletFacade.fetchTermsAndConditions`

  Adds a new `FetchTermsAndConditions` GraphQL query to `@midnight-ntwrk/wallet-sdk-indexer-client` that retrieves the
  current Terms and Conditions (URL and SHA-256 hash) from the network indexer.

  Exposes a new static method `WalletFacade.fetchTermsAndConditions(configuration)` in
  `@midnight-ntwrk/wallet-sdk-facade` that wallet builders can call before or independently of wallet initialization to
  obtain the T&C URL for display and the hash for content verification. The method accepts any configuration that
  includes `indexerClientConnection.indexerHttpUrl`, so the shared wallet configuration can be passed directly without
  adaptation.

- Updated dependencies [9d71d25]
- Updated dependencies [372d964]
- Updated dependencies [aa7b1f4]
- Updated dependencies [07ea767]
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.2.0-rc.0
  - @midnight-ntwrk/wallet-sdk-dust-wallet@3.0.0-rc.0
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@2.1.0-rc.0
  - @midnight-ntwrk/wallet-sdk-shielded@2.1.0-rc.0
  - @midnight-ntwrk/wallet-sdk-address-format@3.1.0-rc.0
  - @midnight-ntwrk/wallet-sdk-capabilities@3.2.0-rc.0

## 2.0.0

### Major Changes

- f52d01d: - expose functions for reverting pending coins (booked for a pending transaction) from a provided transaction
  - extract submission into `@midnight-ntwrk/wallet-sdk-capabilities` package as a standalone service and integrate it
    into the `WalletFacade`
  - make `WalletFacade` revert transaction upon submission failure
  - change initialization of `WalletFacade` to a static async method `WalletFacade.init` taking a configuration object.
    This will allow non-breaking future initialization changes when e.g. new services are being integrated into the
    facade.
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

### Minor Changes

- f52d01d: - Create a pending transactions service in the `@midnight-ntwrk/wallet-sdk-capabilities` package. The service
  checks TTL and status of transactions against indexer in order to report failures. The service state is also meant to
  be serialized and restored in order to not loose track of pending transactions in case of wallet restarts
  - Integrate the pending transactions service into the `WalletFacade`. It registers transactions as soon as they are
    finalized (it can't happen earlier because unproven transactions contain copies of secret keys for proving
    purposes). Whenever a pending transaction is reported as failed - it is reverted. The pending transactions service
    state is also reported in the facade state for serialization purposes and to enable UI reporting.

### Patch Changes

- eb1e4c3: feat: add fee payment option to dust registration and handle deregistration
  - Filter coins already registered for dust generation from fee payment calculations
  - Add `registeredForDustGeneration` flag to `UtxoWithMeta` type
  - Add docs snippets for deregistration and redesignation flows

- 0f29d01: - Moved `SyncProgress` from `wallet-sdk-shielded/v1` into `wallet-sdk-abstractions` so it can be shared
  across wallet implementations
  - Refactored `CoreWallet` in the dust wallet from a class to a plain object type + namespace, improving composability
  - Added `WalletError` type to the dust wallet for structured error handling
  - Added coin data to unshielded transaction history
  - Removed unused `wallet-sdk-hd` dependency from `wallet-sdk-unshielded-wallet`
  - Cleaned up `ProgressUpdate` type and `progress()` method from `TransactionHistoryCapability` in the shielded wallet
    (superseded by the shared `SyncProgress`)
- Updated dependencies [323e0e0]
- Updated dependencies [f52d01d]
- Updated dependencies [c6f6f3e]
- Updated dependencies [7ef6ff9]
- Updated dependencies [d3422bc]
- Updated dependencies [f52d01d]
- Updated dependencies [71b1324]
- Updated dependencies [aa7ede2]
- Updated dependencies [79fb7ba]
- Updated dependencies [eb1e4c3]
- Updated dependencies [dd004db]
- Updated dependencies [0f29d01]
- Updated dependencies [fe57cc3]
- Updated dependencies [1409b6b]
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@2.0.0
  - @midnight-ntwrk/wallet-sdk-shielded@2.0.0
  - @midnight-ntwrk/wallet-sdk-capabilities@3.1.0
  - @midnight-ntwrk/wallet-sdk-dust-wallet@2.0.0
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.1

## 2.0.0-rc.3

### Patch Changes

- eb1e4c3: feat: add fee payment option to dust registration and handle deregistration
  - Filter coins already registered for dust generation from fee payment calculations
  - Add `registeredForDustGeneration` flag to `UtxoWithMeta` type
  - Add docs snippets for deregistration and redesignation flows

- Updated dependencies [eb1e4c3]
  - @midnight-ntwrk/wallet-sdk-dust-wallet@2.0.0-rc.3

## 2.0.0-rc.2

### Major Changes

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

### Patch Changes

- 0f29d01: - Moved `SyncProgress` from `wallet-sdk-shielded/v1` into `wallet-sdk-abstractions` so it can be shared
  across wallet implementations
  - Refactored `CoreWallet` in the dust wallet from a class to a plain object type + namespace, improving composability
  - Added `WalletError` type to the dust wallet for structured error handling
  - Added coin data to unshielded transaction history
  - Removed unused `wallet-sdk-hd` dependency from `wallet-sdk-unshielded-wallet`
  - Cleaned up `ProgressUpdate` type and `progress()` method from `TransactionHistoryCapability` in the shielded wallet
    (superseded by the shared `SyncProgress`)
- Updated dependencies [323e0e0]
- Updated dependencies [d3422bc]
- Updated dependencies [79fb7ba]
- Updated dependencies [0f29d01]
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@2.0.0-rc.2
  - @midnight-ntwrk/wallet-sdk-shielded@2.0.0-rc.2
  - @midnight-ntwrk/wallet-sdk-dust-wallet@2.0.0-rc.2
  - @midnight-ntwrk/wallet-sdk-capabilities@3.1.0-rc.2

## 2.0.0-rc.1

### Patch Changes

- Updated dependencies [3843720]
- Updated dependencies [fe57cc3]
  - @midnight-ntwrk/wallet-sdk-abstractions@2.0.0-rc.0
  - @midnight-ntwrk/wallet-sdk-shielded@2.0.0-rc.1
  - @midnight-ntwrk/wallet-sdk-dust-wallet@2.0.0-rc.1
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@2.0.0-rc.1
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

### Minor Changes

- f52d01d: - Create a pending transactions service in the `@midnight-ntwrk/wallet-sdk-capabilities` package. The service
  checks TTL and status of transactions against indexer in order to report failures. The service state is also meant to
  be serialized and restored in order to not loose track of pending transactions in case of wallet restarts
  - Integrate the pending transactions service into the `WalletFacade`. It registers transactions as soon as they are
    finalized (it can't happen earlier because unproven transactions contain copies of secret keys for proving
    purposes). Whenever a pending transaction is reported as failed - it is reverted. The pending transactions service
    state is also reported in the facade state for serialization purposes and to enable UI reporting.

### Patch Changes

- Updated dependencies [f52d01d]
- Updated dependencies [c6f6f3e]
- Updated dependencies [f52d01d]
- Updated dependencies [aa7ede2]
- Updated dependencies [1409b6b]
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@2.0.0-rc.0
  - @midnight-ntwrk/wallet-sdk-shielded@2.0.0-rc.0
  - @midnight-ntwrk/wallet-sdk-capabilities@3.1.0-rc.0
  - @midnight-ntwrk/wallet-sdk-dust-wallet@2.0.0-rc.0

## 1.0.0

### Patch Changes

- 3f14055: chore: bump ledger to version 6.1.0-alpha.6
- 390c797: Adds optional balancing support and refactors wallet facade API methods.

  **Breaking Changes:**
  - All balancing methods (`balanceFinalizedTransaction`, `balanceUnboundTransaction`, `balanceUnprovenTransaction`) now
    accept parameters as grouped objects (`secretKeys` and `options`) instead of individual parameters
  - The `transferTransaction` and `initSwap` methods now group parameters into `secretKeys` and `options` objects
  - Renamed `signTransaction` to `signUnprovenTransaction`

  **New Features:**
  - Add `options.tokenKindsToBalance` parameter to balancing methods, allowing selective balancing of specific token
    types (dust, shielded, unshielded) instead of always balancing all types
  - Add `options.payFees` parameter to `transferTransaction` and `initSwap` methods to control fee payment
  - Add new `signUnboundTransaction` method

  **Internal Changes:**
  - `balancingTransaction` is now optional in `UnboundTransactionRecipe` when only unshielded balancing is performed

- fb55d52: Introduce more convenient API for Bech32m address encoding/decoding Remove network id from Dust wallet
  initialization methods (so they are read from the configuration) Introduce FacadeState and add a getter to check for
  sync status of whole facade wallet Introduce CompositeDerivation for HD wallet, so that it is possible to derive keys
  for multiple roles at once
- eec1ddb: feat: rewrite balancing recipes
- f7aac06: Update blockchain dependencies to latest versions:
  - Upgrade `@midnight-ntwrk/ledger-v7` from `7.0.0-rc.1` to `7.0.0` (stable release)
  - Update `indexer-standalone` Docker image from `3.0.0-alpha.25` to `3.0.0-rc.1`
  - Update `midnight-node` Docker image from `0.20.0-rc.1` to `0.20.0-rc.6`

- 8b8d708: chore: update ledger to version 7.0.0-rc.1
- fb55d52: chore: initialize baseline release after introducing Changesets
- fb55d52: chore: force re-release after workspace failure
- a768341: Expose a method enabling to estimate requirements for issuing a Dust designation tx
- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs
- fb55d52: chore: bump ledger to version 6.1.0-beta.5
- 2c4a115: fix: fixes unshielded state sync update
- b9865cf: feat: rewrite unshielded wallet runtime
- Updated dependencies [3f14055]
- Updated dependencies [390c797]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
- Updated dependencies [eec1ddb]
- Updated dependencies [f7aac06]
- Updated dependencies [fb55d52]
- Updated dependencies [a06ccf3]
- Updated dependencies [aef8d4b]
- Updated dependencies [8b8d708]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
- Updated dependencies [aa3c5d7]
- Updated dependencies [a768341]
- Updated dependencies [fb55d52]
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
- Updated dependencies [283ff55]
- Updated dependencies [446331c]
- Updated dependencies [b9865cf]
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@1.0.0
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0
  - @midnight-ntwrk/wallet-sdk-dust-wallet@1.0.0
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0

## 1.0.0-beta.17

### Patch Changes

- 390c797: Adds optional balancing support and refactors wallet facade API methods.

  **Breaking Changes:**
  - All balancing methods (`balanceFinalizedTransaction`, `balanceUnboundTransaction`, `balanceUnprovenTransaction`) now
    accept parameters as grouped objects (`secretKeys` and `options`) instead of individual parameters
  - The `transferTransaction` and `initSwap` methods now group parameters into `secretKeys` and `options` objects
  - Renamed `signTransaction` to `signUnprovenTransaction`

  **New Features:**
  - Add `options.tokenKindsToBalance` parameter to balancing methods, allowing selective balancing of specific token
    types (dust, shielded, unshielded) instead of always balancing all types
  - Add `options.payFees` parameter to `transferTransaction` and `initSwap` methods to control fee payment
  - Add new `signUnboundTransaction` method

  **Internal Changes:**
  - `balancingTransaction` is now optional in `UnboundTransactionRecipe` when only unshielded balancing is performed

- f7aac06: Update blockchain dependencies to latest versions:
  - Upgrade `@midnight-ntwrk/ledger-v7` from `7.0.0-rc.1` to `7.0.0` (stable release)
  - Update `indexer-standalone` Docker image from `3.0.0-alpha.25` to `3.0.0-rc.1`
  - Update `midnight-node` Docker image from `0.20.0-rc.1` to `0.20.0-rc.6`

- Updated dependencies [390c797]
- Updated dependencies [f7aac06]
- Updated dependencies [446331c]
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@1.0.0-beta.19
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.17
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.12
  - @midnight-ntwrk/wallet-sdk-dust-wallet@1.0.0-beta.16

## 1.0.0-beta.16

### Patch Changes

- eec1ddb: feat: rewrite balancing recipes
- a768341: Expose a method enabling to estimate requirements for issuing a Dust designation tx
- Updated dependencies [eec1ddb]
- Updated dependencies [aa3c5d7]
- Updated dependencies [a768341]
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@1.0.0-beta.18
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.16
  - @midnight-ntwrk/wallet-sdk-dust-wallet@1.0.0-beta.15

## 1.0.0-beta.15

### Patch Changes

- 8b8d708: chore: update ledger to version 7.0.0-rc.1
- Updated dependencies [8b8d708]
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@1.0.0-beta.17
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.15
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-dust-wallet@1.0.0-beta.14

## 1.0.0-beta.14

### Patch Changes

- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@1.0.0-beta.16
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.14
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-dust-wallet@1.0.0-beta.13
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.8

## 1.0.0-beta.13

### Patch Changes

- Updated dependencies [aef8d4b]
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@1.0.0-beta.15
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.13
  - @midnight-ntwrk/wallet-sdk-dust-wallet@1.0.0-beta.12

## 1.0.0-beta.12

### Patch Changes

- b9865cf: feat: rewrite unshielded wallet runtime
- Updated dependencies [283ff55]
- Updated dependencies [b9865cf]
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@1.0.0-beta.14
  - @midnight-ntwrk/wallet-sdk-dust-wallet@1.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.12

## 1.0.0-beta.11

### Patch Changes

- 3f14055: chore: bump ledger to version 6.1.0-alpha.6
- 2c4a115: fix: fixes unshielded state sync update
- Updated dependencies [3f14055]
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@1.0.0-beta.13
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-dust-wallet@1.0.0-beta.10

## 1.0.0-beta.10

### Patch Changes

- fb55d52: Introduce more convenient API for Bech32m address encoding/decoding Remove network id from Dust wallet
  initialization methods (so they are read from the configuration) Introduce FacadeState and add a getter to check for
  sync status of whole facade wallet Introduce CompositeDerivation for HD wallet, so that it is possible to derive keys
  for multiple roles at once
- Updated dependencies [fb55d52]
- Updated dependencies [a06ccf3]
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-dust-wallet@1.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@1.0.0-beta.12

## 1.0.0-beta.9

### Patch Changes

- 1db4280: chore: bump ledger to version 6.1.0-beta.5
- Updated dependencies [0838f04]
- Updated dependencies [f967d17]
- Updated dependencies [f6618f1]
- Updated dependencies [1db4280]
- Updated dependencies [646c8df]
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-dust-wallet@1.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@1.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.8

## 1.0.0-beta.8

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure
- Updated dependencies [2a0d132]
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@1.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-dust-wallet@1.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.6

## 1.0.0-beta.7

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
- Updated dependencies [ae22baf]
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.5
  - @midnight-ntwrk/wallet-sdk-dust-wallet@1.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.5
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@1.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.7
