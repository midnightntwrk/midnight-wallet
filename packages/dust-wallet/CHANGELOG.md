# @midnightntwrk/wallet-sdk-dust-wallet

## 5.0.0

### Major Changes

- ef16433: **BREAKING:** `DustWalletAPI.balanceTransactions` now returns
  `{ transaction: UnprovenTransaction; blockData: BlockData }` instead of `UnprovenTransaction`. Callers must read the
  transaction from the `transaction` field; the accompanying `blockData` (hash, height, timestamp, ledger parameters)
  captured during balancing can be reused downstream to avoid a redundant fetch.

  Also exposes the `BlockData` type from the package's public surface.

### Minor Changes

- e89ab0b: Track transaction lifecycle in transaction history. Submitted transactions are now recorded as pending,
  transition to finalized once confirmed by the indexer, and to rejected if they are reverted — giving a single,
  consistent view of in-flight and settled transactions.

### Patch Changes

- 1eaad77: Pin internal `@midnightntwrk/wallet-sdk-*` dependencies to exact versions instead of caret ranges. A caret
  range on a prerelease base (e.g. `^5.0.0-beta.0`) satisfies canary snapshots published on the same `major.minor.patch`
  (`5.0.0-canary.*`), and since `canary` sorts above `beta`/`alpha`, installing a prerelease pulled canary builds of the
  sibling packages. Exact pins make published releases resolve to a single coherent set regardless of what snapshots
  exist on the registry.
- Updated dependencies [44bbcae]
- Updated dependencies [e89ab0b]
- Updated dependencies [1eaad77]
- Updated dependencies [ef16433]
  - @midnightntwrk/wallet-sdk-indexer-client@1.3.0
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0
  - @midnightntwrk/wallet-sdk-capabilities@3.4.0
  - @midnightntwrk/wallet-sdk-runtime@1.0.6

## 4.2.0

### Minor Changes

- dff5706: Fix a race in `WalletFacade.registerNightUtxosForDustGeneration` where the registration's `allow_fee_payment`
  could be below its own fee, causing the chain to reject submission with `BalanceCheckOverspend`. The wallet now
  estimates the fee at build time, reverts the booking, and throws before submission. Adds
  `WalletFacade.waitForGeneratedDust(utxos, requiredAmount, opts?)` so callers can defer registration until enough dust
  has accrued — pair with `estimateRegistration` to pick the threshold.

### Patch Changes

- Updated dependencies [417d042]
- Updated dependencies [0b41e11]
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.3
  - @midnightntwrk/wallet-sdk-runtime@1.0.5

## 4.1.0

### Minor Changes

- 6e187fe: Fix a race where Dust registration / deregistration would double-use Night UTxOs that another in-flight
  transaction was already trying to spend. The build flow now books the chosen Night UTxOs (available → pending) at
  build time, so a conflicting concurrent build fails immediately with `SpendUtxoError` instead of only at submission.
  Adds new methods on `UnshieldedWallet` (`rotateUtxos`) and `DustWallet` (`splitNightUtxosForDustRegistration`,
  `attachDustRegistration`) to support the split build.

### Patch Changes

- 0fd0062: Fix dust fee balancing failing with `InsufficientFunds` despite ample dust (issue #383). Two compounding
  defects in the dust wallet's coin selection:
  - The local `chooseCoin` now skips zero-value coins, so a freshly-registered dust UTXO with `generatedNow === 0` no
    longer wastes an iteration as the smallest candidate. The local `CoinSelection` type and `chooseCoin` signature were
    realigned with the capabilities `CoinRecipe` API, and the variant now passes its configured coin selection through
    to `getBalanceRecipe`. Note: `CoinsAndBalances.CoinSelection` is no longer parametrized — it changed from
    `CoinSelection<TInput>` to a polymorphic `CoinSelection`. The prior wiring was non-functional (the variant's
    `coinSelection` slot was never invoked), so any consumer who customized it had no observable behavior; only the type
    reference needs updating.
  - `computeBalancingRecipe` now identifies coins by `token.nonce` rather than by `value` when removing the just-picked
    coin from the working set. Value-equality previously caused a single pick to drop the entire cohort of dust UTXOs
    sharing the same `generatedNow` (a routine outcome once their backing Night UTXOs reach `maxCap`), making most of
    the wallet's spendable dust invisible to the balancer.

- 7452e96: Bump `@midnight-ntwrk/ledger-v8` from `^8.0.3` to `^8.1.0`. Internal balancing flows in `dust-wallet`,
  `unshielded-wallet`, and `shielded-wallet` are refactored to use the new ledger 8.1.0 builder API
  (`Transaction.addIntent`, `Transaction.addZswapOffer`) instead of post-construction field mutation on
  `Transaction.fromParts(...)`. No public API changes; consumers must resolve `@midnight-ntwrk/ledger-v8` to `>=8.1.0`.
- 25f58b4: Widen ranges for internal `@midnightntwrk/wallet-sdk-*` dependencies from exact versions to caret ranges so
  consumers can dedupe shared sibling packages into a single installed copy.
- Updated dependencies [6e187fe]
- Updated dependencies [7452e96]
- Updated dependencies [25f58b4]
  - @midnightntwrk/wallet-sdk-utilities@1.2.0
  - @midnightntwrk/wallet-sdk-address-format@3.1.2
  - @midnightntwrk/wallet-sdk-capabilities@3.3.1
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.2
  - @midnightntwrk/wallet-sdk-runtime@1.0.4

## 4.0.0

### Major Changes

- 55715af: **BREAKING:** `getAvailableCoins`, `getPendingCoins`, and `getTotalCoins` now return `DustFullInfo` (with
  generation details) instead of raw `Dust`. Access the underlying `Dust` via the `.token` property. Removes
  `getAvailableCoinsWithFullInfo`, `getPendingCoinsWithFullInfo`, and `getTotalCoinsWithFullInfo`. The methods now
  accept an optional `time` parameter, defaulting to `syncTime`.
- 3763803: Add txHistory functionality to the dust wallet

### Patch Changes

- e57a94b: Unify Simulator into capabilities package with proper fee payment and block production model
- c1ae369: Fix transaction history race condition by consolidating merge logic in the facade and delegating it to
  storage at construction time.
- eba8e08: Expose CustomDustWallet factory and generic types (CustomizedDustWallet, CustomizedDustWalletClass) to allow
  custom variant builders, matching the shielded and unshielded wallet patterns
- 8383f7b: Remove the double exporting of TransactionHistory.js
- 1f794fa: feat: deterministically set balancing tx segment id

  Replaced `Transaction.fromPartsRandomized` with `Transaction.fromParts` + explicit `intents.set(segmentId, intent)`
  when building balancing transactions, where `segmentId` is the lowest unused fallible segment in `[1, 65535]`. This
  makes segment placement deterministic and reproducible instead of random.
  - **dust-wallet**: `dryRunFee` and `balanceTransactions` now merge the existing (proof-erased) transactions first,
    then pick a segment that doesn't collide with any of them before constructing the balancing tx. A new exported
    `findAvailableSegmentId` helper in `Transacting.ts` drives the lookup.
  - **unshielded-wallet**: `balanceFinalizedTransaction` picks a segment that doesn't collide with the passed-in
    `FinalizedTransaction` before constructing the balancing tx. `findAvailableSegmentId` was added as a method on
    `TransactionOps`.

- 0db3290: chore: bump ledger version to 8.0.3
- 0529e6a: Add `batchUpdates` option to `DefaultSyncConfiguration` for controlling sync stream batching (size, timeout,
  and spacing between batches)
- 7f82432: Introduce a shared transaction history storage layer with support for wallet-specific augmentation.
  Reimplement shielded wallet transaction history and refactor unshielded wallet transaction history to use the new
  shared storage.
- Updated dependencies [e57a94b]
- Updated dependencies [c1ae369]
- Updated dependencies [0db3290]
- Updated dependencies [7f82432]
  - @midnightntwrk/wallet-sdk-capabilities@3.3.0
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.1
  - @midnightntwrk/wallet-sdk-abstractions@2.1.0
  - @midnightntwrk/wallet-sdk-address-format@3.1.1
  - @midnightntwrk/wallet-sdk-utilities@1.1.1
  - @midnightntwrk/wallet-sdk-runtime@1.0.3

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

- 372d964: fix: optimize balancing error message reporting
- 1ad34a9: fix: clear ZswapSecretKeys from memory after use instead of only nullifying the reference
- Updated dependencies [9d71d25]
- Updated dependencies [ea55591]
- Updated dependencies [aa7b1f4]
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.0
  - @midnightntwrk/wallet-sdk-utilities@1.1.0
  - @midnightntwrk/wallet-sdk-address-format@3.1.0
  - @midnightntwrk/wallet-sdk-capabilities@3.2.0
  - @midnightntwrk/wallet-sdk-runtime@1.0.2

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

- 372d964: fix: optimize balancing error message reporting
- Updated dependencies [9d71d25]
- Updated dependencies [ea55591]
- Updated dependencies [aa7b1f4]
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.0-rc.0
  - @midnightntwrk/wallet-sdk-utilities@1.1.0-rc.0
  - @midnightntwrk/wallet-sdk-address-format@3.1.0-rc.0
  - @midnightntwrk/wallet-sdk-capabilities@3.2.0-rc.0
  - @midnightntwrk/wallet-sdk-runtime@1.0.2-rc.0

## 2.0.0

### Major Changes

- f52d01d: - expose functions for reverting pending coins (booked for a pending transaction) from a provided transaction
  - extract submission into `@midnightntwrk/wallet-sdk-capabilities` package as a standalone service and integrate it
    into the `WalletFacade`
  - make `WalletFacade` revert transaction upon submission failure
  - change initialization of `WalletFacade` to a static async method `WalletFacade.init` taking a configuration object.
    This will allow non-breaking future initialization changes when e.g. new services are being integrated into the
    facade.
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

- 71b1324: Use intent spend time instead of pending spend ctime when processing TTLs during dust wallet reversion, and
  fix pending dust accumulation across multiple coin spends
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

- eb1e4c3: feat: add fee payment option to dust registration and handle deregistration
  - Filter coins already registered for dust generation from fee payment calculations
  - Add `registeredForDustGeneration` flag to `UtxoWithMeta` type
  - Add docs snippets for deregistration and redesignation flows

- dd004db: Add optional `keepAlive` config param to `SubscriptionClient.ServerConfig` and to `IndexerClientConnection`
  in all wallet packages. The value is forwarded to the underlying `graphql-ws` client and defaults to `15_000` ms when
  not provided.
- 0f29d01: - Moved `SyncProgress` from `wallet-sdk-shielded/v1` into `wallet-sdk-abstractions` so it can be shared
  across wallet implementations
  - Refactored `CoreWallet` in the dust wallet from a class to a plain object type + namespace, improving composability
  - Added `WalletError` type to the dust wallet for structured error handling
  - Added coin data to unshielded transaction history
  - Removed unused `wallet-sdk-hd` dependency from `wallet-sdk-unshielded-wallet`
  - Cleaned up `ProgressUpdate` type and `progress()` method from `TransactionHistoryCapability` in the shielded wallet
    (superseded by the shared `SyncProgress`)
- Updated dependencies [f52d01d]
- Updated dependencies [3843720]
- Updated dependencies [6c359b8]
- Updated dependencies [7ef6ff9]
- Updated dependencies [d3422bc]
- Updated dependencies [f52d01d]
- Updated dependencies [dd004db]
- Updated dependencies [0f29d01]
- Updated dependencies [55380e5]
- Updated dependencies [330867f]
  - @midnightntwrk/wallet-sdk-capabilities@3.1.0
  - @midnightntwrk/wallet-sdk-abstractions@2.0.0
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0
  - @midnightntwrk/wallet-sdk-address-format@3.0.1
  - @midnightntwrk/wallet-sdk-utilities@1.0.1
  - @midnightntwrk/wallet-sdk-runtime@1.0.1

## 2.0.0-rc.5

### Patch Changes

- dd004db: Add optional `keepAlive` config param to `SubscriptionClient.ServerConfig` and to `IndexerClientConnection`
  in all wallet packages. The value is forwarded to the underlying `graphql-ws` client and defaults to `15_000` ms when
  not provided.
- Updated dependencies [dd004db]
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0-rc.4

## 2.0.0-rc.4

### Patch Changes

- Updated dependencies [55380e5]
  - @midnightntwrk/wallet-sdk-utilities@1.0.1-rc.1
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0-rc.3
  - @midnightntwrk/wallet-sdk-runtime@1.0.1-rc.2

## 2.0.0-rc.3

### Patch Changes

- eb1e4c3: feat: add fee payment option to dust registration and handle deregistration
  - Filter coins already registered for dust generation from fee payment calculations
  - Add `registeredForDustGeneration` flag to `UtxoWithMeta` type
  - Add docs snippets for deregistration and redesignation flows

## 2.0.0-rc.2

### Major Changes

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

### Patch Changes

- 0f29d01: - Moved `SyncProgress` from `wallet-sdk-shielded/v1` into `wallet-sdk-abstractions` so it can be shared
  across wallet implementations
  - Refactored `CoreWallet` in the dust wallet from a class to a plain object type + namespace, improving composability
  - Added `WalletError` type to the dust wallet for structured error handling
  - Added coin data to unshielded transaction history
  - Removed unused `wallet-sdk-hd` dependency from `wallet-sdk-unshielded-wallet`
  - Cleaned up `ProgressUpdate` type and `progress()` method from `TransactionHistoryCapability` in the shielded wallet
    (superseded by the shared `SyncProgress`)
- Updated dependencies [d3422bc]
- Updated dependencies [0f29d01]
  - @midnightntwrk/wallet-sdk-capabilities@3.1.0-rc.2
  - @midnightntwrk/wallet-sdk-abstractions@2.0.0-rc.1
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0-rc.2
  - @midnightntwrk/wallet-sdk-runtime@1.0.1-rc.1

## 2.0.0-rc.1

### Patch Changes

- Updated dependencies [3843720]
- Updated dependencies [330867f]
- Updated dependencies [fe57cc3]
  - @midnightntwrk/wallet-sdk-abstractions@2.0.0-rc.0
  - @midnightntwrk/wallet-sdk-utilities@1.0.1-rc.0
  - @midnightntwrk/wallet-sdk-shielded@2.0.0-rc.1
  - @midnightntwrk/wallet-sdk-prover-client@1.1.0-rc.1
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0-rc.1
  - @midnightntwrk/wallet-sdk-capabilities@3.1.0-rc.1

## 2.0.0-rc.0

### Major Changes

- f52d01d: - expose functions for reverting pending coins (booked for a pending transaction) from a provided transaction
  - extract submission into `@midnightntwrk/wallet-sdk-capabilities` package as a standalone service and integrate it
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
  - @midnightntwrk/wallet-sdk-shielded@2.0.0-rc.0
  - @midnightntwrk/wallet-sdk-capabilities@3.1.0-rc.0
  - @midnightntwrk/wallet-sdk-indexer-client@1.1.0-rc.0
  - @midnightntwrk/wallet-sdk-prover-client@1.1.0-rc.0

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
  - @midnightntwrk/wallet-sdk-shielded@1.0.0
  - @midnightntwrk/wallet-sdk-address-format@3.0.0
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0
  - @midnightntwrk/wallet-sdk-node-client@1.0.0
  - @midnightntwrk/wallet-sdk-utilities@1.0.0
  - @midnightntwrk/wallet-sdk-hd@3.0.0
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0

## 1.0.0-beta.16

### Patch Changes

- f7aac06: Update blockchain dependencies to latest versions:
  - Upgrade `@midnight-ntwrk/ledger-v7` from `7.0.0-rc.1` to `7.0.0` (stable release)
  - Update `indexer-standalone` Docker image from `3.0.0-alpha.25` to `3.0.0-rc.1`
  - Update `midnight-node` Docker image from `0.20.0-rc.1` to `0.20.0-rc.6`

- Updated dependencies [f7aac06]
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.17
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.12
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.14
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.12
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.13
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.11
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.17

## 1.0.0-beta.15

### Patch Changes

- eec1ddb: feat: rewrite balancing recipes
- aa3c5d7: Batch events for processing for better responsiveness and performance
- a768341: Use fallible section to enable usage of more than 1 pair of Night input/output
- Updated dependencies [eec1ddb]
- Updated dependencies [aa3c5d7]
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.16

## 1.0.0-beta.14

### Patch Changes

- 8b8d708: chore: update ledger to version 7.0.0-rc.1
- Updated dependencies [8b8d708]
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.15
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.11
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.13
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.11
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.12
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.10
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.16

## 1.0.0-beta.13

### Patch Changes

- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs
- Updated dependencies [94a39ef]
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.15
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.14
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.10
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.12
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.10
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.11
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.9
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.10
  - @midnightntwrk/wallet-sdk-hd@3.0.0-beta.8

## 1.0.0-beta.12

### Patch Changes

- aef8d4b: Performance improvement: Shielded and Dust wallet now send events in batches of 50 or after 10 seconds if
  total events has not reached 50
- Updated dependencies [aef8d4b]
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.13
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.11
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.8
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.14

## 1.0.0-beta.11

### Patch Changes

- Updated dependencies [b9865cf]
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.13
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.12

## 1.0.0-beta.10

### Patch Changes

- 3f14055: chore: bump ledger to version 6.1.0-alpha.6
- Updated dependencies [3f14055]
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.11
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.9
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.10
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.9
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.10

## 1.0.0-beta.9

### Patch Changes

- fb55d52: Introduce more convenient API for Bech32m address encoding/decoding Remove network id from Dust wallet
  initialization methods (so they are read from the configuration) Introduce FacadeState and add a getter to check for
  sync status of whole facade wallet Introduce CompositeDerivation for HD wallet, so that it is possible to derive keys
  for multiple roles at once
- Updated dependencies [fb55d52]
- Updated dependencies [a06ccf3]
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.8
  - @midnightntwrk/wallet-sdk-hd@3.0.0-beta.7
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.9
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.8
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.10
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.12
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.9

## 1.0.0-beta.8

### Patch Changes

- f967d17: chore: remove wallet api dep from dust wallet
- 1db4280: chore: bump ledger to version 6.1.0-beta.5
- Updated dependencies [976628a]
- Updated dependencies [0838f04]
- Updated dependencies [f6618f1]
- Updated dependencies [1db4280]
- Updated dependencies [646c8df]
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.8
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.7
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.9
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.7
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.11
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.8
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.7
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.9

## 1.0.0-beta.7

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure
- Updated dependencies [2a0d132]
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.6
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.10
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.7
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.7
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.6
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.8
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.6
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.8
  - @midnightntwrk/wallet-sdk-hd@3.0.0-beta.6

## 1.0.0-beta.6

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
- Updated dependencies [ae22baf]
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.6
  - @midnightntwrk/wallet-sdk-address-format@3.0.0-beta.5
  - @midnightntwrk/wallet-sdk-capabilities@3.0.0-beta.5
  - @midnightntwrk/wallet-sdk-hd@3.0.0-beta.5
  - @midnightntwrk/wallet-sdk-indexer-client@1.0.0-beta.9
  - @midnightntwrk/wallet-sdk-node-client@1.0.0-beta.7
  - @midnightntwrk/wallet-sdk-prover-client@1.0.0-beta.6
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.5
  - @midnightntwrk/wallet-sdk-shielded@1.0.0-beta.7
