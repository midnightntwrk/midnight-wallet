# Midnight Wallet SDK - Release Notes

### Version 2.0.0

**Version:** 2.0.0 **Date:** 2026-03-10 **Environment:** Preprod, Preview

---

### High-level summary

Major release focused on architectural decoupling. Proving, submission, and pending-transaction tracking are extracted
into standalone services owned by `WalletFacade`. Wallet APIs are standardized across shielded, unshielded, and dust
wallets. WASM-based proving is now available as an alternative to the HTTP prover server. `WalletFacade` now
automatically reverts transactions when proving or submission fails.

---

### Audience

This release is relevant for developers who:

- Build wallets for the Midnight network
- Integrate Midnight token transfers into their DApps
- Need to manage shielded (private) and unshielded token balances
- Implement atomic swaps between parties

---

### What changed (Summary of updates)

- Proving extracted into standalone `ProvingService` supporting server (HTTP), WASM, and simulator modes
- Transaction submission extracted into standalone `SubmissionService`
- New `PendingTransactionsService` monitors TTL/status and auto-reverts failed transactions
- `WalletFacade` initialization changed to static async `WalletFacade.init()`
- `WalletFacade` reverts transactions automatically on proving or submission failure
- Wallet APIs standardized across shielded, unshielded, and dust wallets (renames, new methods)
- `SyncProgress` moved to `wallet-sdk-abstractions` for shared use across all wallet types
- Unshielded transaction history now includes created and spent UTXOs per entry
- Optional `keepAlive` config added to `IndexerClientConnection`
- WASM proving provider available via Web Worker
- Node client connects WebSocket on-demand to prevent service worker timer leaks

---

### New features

**Standalone ProvingService**

**Description:** Proving is extracted from individual wallet builders into a standalone `ProvingService` in
`@midnight-ntwrk/wallet-sdk-capabilities`. Supports server (HTTP prover), WASM, and simulator modes through a unified
configuration. `WalletFacade` now owns proving and reverts the transaction across all three wallet types on failure.

**Example:** [wasm-prover.ts](packages/docs-snippets/src/snippets/wasm-prover.ts)

---

**Standalone SubmissionService**

**Description:** Transaction submission is extracted into a standalone `SubmissionService` in
`@midnight-ntwrk/wallet-sdk-capabilities` and integrated into `WalletFacade`. The facade reverts the transaction when
submission fails.

---

**PendingTransactionsService**

**Description:** New service in `@midnight-ntwrk/wallet-sdk-capabilities` that monitors TTL and indexer status of
submitted transactions. Automatically reverts the wallet state when a pending transaction is reported as failed. Service
state is serializable so pending transactions survive wallet restarts.

---

**WASM Proving Provider**

**Description:** Web Worker-based proof generation as an alternative to a remote prover server. Configure via
`ProverClient.WasmConfig`. Midnight-specific key material is used instead of Filecoin keys.

**Example:** [wasm-prover.ts](packages/docs-snippets/src/snippets/wasm-prover.ts)

---

**Custom Prover Integration**

**Description:** `asProvingProvider()` method added to `HttpProverClient` and `WasmProver` to expose the underlying
proving provider. `create()` factory functions allow direct instantiation without Effect layers. `fromProvingProvider()`
and `fromProvingProviderEffect()` helpers on the `Proving` module enable custom prover workflows.

---

**Dust Registration Fee Payment and Deregistration**

**Description:** Fee payment is now an optional parameter for dust registration transactions. Deregistration and
redesignation flows are supported. A `registeredForDustGeneration` flag is added to `UtxoWithMeta`.

**Example:** [deregistration.ts](packages/docs-snippets/src/snippets/deregistration.ts)

---

**Unshielded Transaction History with UTXOs**

**Description:** Each `TransactionHistoryEntry` in the unshielded wallet now carries `createdUtxos` and `spentUtxos`
arrays. Each UTXO exposes its `value`, `owner`, `tokenType`, `intentHash`, and `outputIndex`.

---

**Shared SyncProgress**

**Description:** `SyncProgress` is moved from `wallet-sdk-shielded/v1` into `wallet-sdk-abstractions` so it can be used
across all wallet implementations without importing from the shielded package.

---

**Promise-based QueryRunner**

**Description:** New utility in `@midnight-ntwrk/wallet-sdk-indexer-client` for executing GraphQL queries without Effect
boilerplate.

---

### New features requiring configuration updates

**ProvingService now required in WalletFacade**

**Required Updates:**

- Pass a `ProvingService` when calling `WalletFacade.init()`, or rely on `DefaultConfiguration` which includes
  `DefaultProvingConfiguration` (requires `provingServerUrl` in config)

**Impact:** `WalletFacade` no longer accepts wallet builders that carry their own proving service. Proving is a
facade-level concern. The `provingServerUrl` field in `DefaultConfiguration` continues to work as before for the default
HTTP proving mode.

---

### Improvements

- `WalletFacade.init()` static async initializer accepts a configuration object, enabling non-breaking future
  initialization changes.
- Optional `keepAlive` parameter on `IndexerClientConnection` and `SubscriptionClient.ServerConfig` (defaults to 15 000
  ms). Forwarded to the underlying `graphql-ws` client.
- Node client (`@midnight-ntwrk/wallet-sdk-node-client`) connects WebSocket on-demand and disconnects after each
  operation, preventing `@polkadot/api` health-check timers from keeping service workers alive.
- `CoreWallet` in the dust wallet refactored from a class to a plain object type + namespace, improving composability.
- `WalletError` type added to the dust wallet for structured error handling.

---

### Deprecations

N/A

---

### Breaking changes or required actions for developers

**`SerializedUnprovenTransaction` replaced by `SerializedTransaction`**

`SerializedUnprovenTransaction` is removed from `@midnight-ntwrk/wallet-sdk-abstractions`. Use `SerializedTransaction`
instead — a simplified type holding serialized transaction bytes.

---

**Shielded Wallet (`@midnight-ntwrk/wallet-sdk-shielded`)**

- `finalizeTransaction` removed from `ShieldedWalletAPI` — handled by `WalletFacade`
- `Proving` export removed from `@midnight-ntwrk/wallet-sdk-shielded/v1`
- `provingService` removed from V1 builder and `RunningV1Variant.Context`
- `withProving` / `withProvingDefaults` removed from `V1Builder`
- `DefaultV1Configuration` no longer includes `DefaultProvingConfiguration`
- `startWithShieldedSeed()` renamed to `startWithSeed()`
- `receiverAddress` parameter type changed from `string` to `ShieldedAddress` in transfer methods
- `getAddress(): Promise<ShieldedAddress>` added to `ShieldedWalletAPI`

---

**Dust Wallet (`@midnight-ntwrk/wallet-sdk-dust-wallet`)**

- `DustCoreWallet` renamed to `CoreWallet`
- `walletBalance()` renamed to `balance()` on `DustWalletState`
- `dustPublicKey` → `publicKey`, `dustAddress` → `address` on state objects
- `getDustPublicKey()` → `getPublicKey()`, `getDustAddress()` → `getAddress()` on `KeysCapability`
- `getAddress(): Promise<DustAddress>` added to `DustWalletAPI`
- `dustReceiverAddress` parameter type changed from `string` to `DustAddress` in transaction methods
- `proveTransaction` removed from `DustWalletAPI`
- `provingService` removed from V1 builder and `RunningV1Variant.Context`
- `withProving` / `withProvingDefaults` removed from `V1Builder`

---

**Facade (`@midnight-ntwrk/wallet-sdk-facade`)**

- `UnboundTransaction` is no longer exported from the facade package — import it from
  `@midnight-ntwrk/wallet-sdk-capabilities/proving`
- `CombinedTokenTransfer` is split into `ShieldedTokenTransfer` and `UnshieldedTokenTransfer`; the union type
  `CombinedTokenTransfer` is still available
- `TokenTransfer` interface now requires typed addresses (`ShieldedAddress` or `UnshieldedAddress`) instead of `string`;
  address encoding is handled internally
- `WalletFacade` constructor replaced by `WalletFacade.init()` static async method
- `WalletFacade` now requires a `ProvingService`; `DefaultConfiguration` includes `DefaultProvingConfiguration`

Migration example:

```ts
// Before
const address = MidnightBech32m.encode('undeployed', state.shielded.address).toString();
wallet.transferTransaction([{ type: 'shielded', outputs: [{ receiverAddress: address, ... }] }]);

// After
const address = await wallet.shielded.getAddress();
wallet.transferTransaction([{ type: 'shielded', outputs: [{ receiverAddress: address, ... }] }]);
```

---

### Known issues

**Issue:** Transaction history not implemented for shielded and dust wallets

**Description:** The shielded and dust wallets do not track transaction history. The shielded wallet's transaction
history getter throws "not yet implemented". Only the unshielded wallet maintains transaction records.

---

**Issue:** Pending coins not cleared after failed transaction submission in the shielded wallet

**Description:** When transaction submission fails for a shielded transaction, coins marked as pending in the shielded
wallet may not be automatically released. **Workaround:** Restart the wallet or re-sync to clear stale pending state.

---

### Packages

| Package                                        | Version | Description                                                                                                                                       |
| ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@midnight-ntwrk/wallet-sdk-facade`            | 2.0.0   | Unified API orchestrating shielded, unshielded, and dust wallets. Owns proving, submission, and pending transaction tracking. Reverts on failure. |
| `@midnight-ntwrk/wallet-sdk-unshielded-wallet` | 2.0.0   | Manages Night and other unshielded tokens. Transaction history now includes created and spent UTXOs per entry.                                    |
| `@midnight-ntwrk/wallet-sdk-shielded`          | 2.0.0   | Manages privacy-preserving shielded tokens. Proving decoupled from wallet builder.                                                                |
| `@midnight-ntwrk/wallet-sdk-dust-wallet`       | 2.0.0   | Manages Dust for transaction fees. Standardized API, deregistration support, fee payment option for registration.                                 |
| `@midnight-ntwrk/wallet-sdk-capabilities`      | 3.1.0   | Shared wallet features. Now includes standalone ProvingService, SubmissionService, and PendingTransactionsService.                                |
| `@midnight-ntwrk/wallet-sdk-abstractions`      | 2.0.0   | Core interfaces and domain types. Now includes shared SyncProgress and SerializedTransaction.                                                     |
| `@midnight-ntwrk/wallet-sdk-prover-client`     | 1.1.0   | Interfaces with the prover service. Now supports WASM proving via Web Worker and exposes proving providers for custom integrations.               |
| `@midnight-ntwrk/wallet-sdk-indexer-client`    | 1.1.0   | Queries the Midnight indexer via GraphQL. Adds QueryRunner utility and keepAlive configuration.                                                   |
| `@midnight-ntwrk/wallet-sdk-address-format`    | 3.0.1   | Encodes and decodes Midnight addresses using Bech32m format.                                                                                      |
| `@midnight-ntwrk/wallet-sdk-hd`                | 3.0.1   | Derives cryptographic keys from a seed following BIP-32/BIP-44/CIP-1852.                                                                          |
| `@midnight-ntwrk/wallet-sdk-node-client`       | 1.0.1   | Communicates with Midnight nodes. Now connects WebSocket on-demand to prevent service worker timer leaks.                                         |
| `@midnight-ntwrk/wallet-sdk-utilities`         | 1.0.1   | Common utilities. Adds safe bigint schema and fixes fromStream dangling subscriber.                                                               |
| `@midnight-ntwrk/wallet-sdk-runtime`           | 1.0.1   | Orchestrates wallet lifecycle and state management.                                                                                               |

---

### Links and references

- SDK Documentation: [link-to-docs]
- Examples: [packages/docs-snippets](packages/docs-snippets)
- GitHub Repository: [midnightntwrk/midnight-wallet](https://github.com/midnightntwrk/midnight-wallet)
- DApp Connector API:
  [midnightntwrk/midnight-dapp-connector-api](https://github.com/midnightntwrk/midnight-dapp-connector-api)

---

### Fixed defect list

- `rollbackSpendByUtxo` no longer throws on missing UTXOs — resolves a race condition between sync and revert
  operations. Function now returns state unchanged when a UTXO is not found.
- `addSignature` now preserves the input transaction type via a generic parameter. Previously always returned
  `UnprovenTransaction`.
- Intent cloning via serialization/deserialization removed from `addSignature`.
- Pending dust accumulation fixed across multiple coin spends.
- Intent spend time (not pending spend ctime) used when processing TTLs during dust wallet reversion.
- `fromStream` no longer leaves a dangling hub subscriber on early unsubscribe.

---

### Version 1.0.0

**Version:** 1.0.0 **Date:** 2026-01-28 **Environment:** Preprod, Preview

---

### High-level summary

This is the initial stable release of the Midnight Wallet SDK, a TypeScript wallet implementation for the Midnight
Network. It provides complete support for Midnight's three-token system: unshielded tokens, shielded tokens with
zero-knowledge proofs, and Dust for fee payments.

---

### Audience

This release is relevant for developers who:

- Build wallets for the Midnight network
- Integrate Midnight token transfers into their DApps
- Need to manage shielded (private) and unshielded token balances
- Implement atomic swaps between parties

---

### What changed (Summary of updates)

- Full support for unshielded tokens (including Night)
- Full support for shielded tokens with zero-knowledge proofs
- Dust management for transaction fee payments
- HD wallet key derivation
- Bech32m address encoding and decoding
- Transaction balancing across all token types
- Atomic swap support

---

### New features

**Wallet Facade**

**Description:** Unified API that orchestrates shielded, unshielded, and dust wallets through a single interface.
Handles transaction balancing, transfers, and swaps. This is the main entry point for most developers, abstracting the
complexity of managing three separate wallet types.

**Examples:** [initialization.ts](packages/docs-snippets/src/snippets/initialization.ts),
[combined-transfer.ts](packages/docs-snippets/src/snippets/combined-transfer.ts)

---

**Unshielded Wallet**

**Description:** Manages Night and other unshielded tokens using a UTxO model with Schnorr signatures. Tracks UTxOs,
creates offers for swaps, and provides inputs/outputs for transaction balancing. Use this for transparent token
operations.

**Example:** [unshielded-transfer.ts](packages/docs-snippets/src/snippets/unshielded-transfer.ts)

---

**Shielded Wallet**

**Description:** Manages privacy-preserving shielded tokens using Zswap zero-knowledge proofs. Handles ZK proof
generation, coin commitment tracking, and encrypted output decryption. Token values and addresses are hidden from
observers while maintaining verifiability.

**Example:** [shielded-transfer.ts](packages/docs-snippets/src/snippets/shielded-transfer.ts)

---

**Dust Wallet**

**Description:** Manages Dust, the fee payment resource generated from Night holdings. Handles Dust address designation,
balance tracking, and automatic fee payment during transaction balancing. Required for submitting any transaction on the
network.

**Example:** [designation.ts](packages/docs-snippets/src/snippets/designation.ts)

---

**HD Wallet**

**Description:** Derives cryptographic keys from a seed following BIP-32/BIP-44/CIP-1852 standards. Generates keys for
unshielded (secp256k1), shielded (JubJub curve), and Dust (BLS12-381 curve) operations from a single mnemonic or seed.

**Example:** [hd.no-net.ts](packages/docs-snippets/src/snippets/hd.no-net.ts)

---

**Address Format**

**Description:** Encodes and decodes Midnight addresses using Bech32m format. Supports three address types with network
identifiers:

- `mn_addr` - Unshielded payment addresses
- `mn_shield-addr` - Shielded payment addresses
- `mn_dust-addr` - Dust addresses for fee generation

**Example:** [addresses.no-net.ts](packages/docs-snippets/src/snippets/addresses.no-net.ts)

---

**Transaction Balancing**

**Description:** Automatically provides inputs to cover outputs, creates change outputs for surplus, and adds Dust
spends for fees. Works across all token types in a single transaction. This is the core operation that enables
transfers, contract interactions, and swaps.

**Example:** [balancing.ts](packages/docs-snippets/src/snippets/balancing.ts)

---

**Atomic Swaps**

**Description:** Enables trustless token exchanges between parties using Midnight's offer system. Offers can be merged
into a single transaction that hides the exchanged amounts from observers. Currently supports shielded-only or
unshielded-only swaps.

**Example:** [swap.ts](packages/docs-snippets/src/snippets/swap.ts)

---

### New features requiring configuration updates

**Prover Service Connection**

**Required Updates:**

- Configure prover service endpoint URL
- Ensure prover service is running and accessible

**Impact:** Zero-knowledge proofs for shielded transactions and Dust spends require an external prover service. The
wallet cannot submit shielded transactions without this configuration.

---

**Node Endpoint**

**Required Updates:**

- Configure Midnight node WebSocket endpoint

**Impact:** The wallet requires a connection to a Midnight node to submit transactions and query blockchain state.

---

**Indexer Endpoint**

**Required Updates:**

- Configure indexer GraphQL endpoint

**Impact:** The wallet requires a connection to the indexer to synchronize UTxOs, transaction history, and state data.

---

### Improvements

N/A - Initial release.

---

### Deprecations

N/A - Initial release.

---

### Breaking changes or required actions for developers

N/A - Initial release.

---

### Known issues

**Issue:** Pending coins not cleared on transaction failure

**Description:** When transaction submission or proof generation fails, coins marked as pending are not automatically
released. This can cause the wallet to report lower available balances until the pending state is manually cleared or
the wallet is restarted. **Workaround:** Restart the wallet or re-sync to clear stale pending state.

---

**Issue:** Transaction history not implemented for shielded and dust wallets

**Description:** The shielded and dust wallets do not currently track transaction history. While the unshielded wallet
maintains transaction records, the shielded and dust wallets only track coin balances without historical transaction
data.

---

### Packages

| Package                                        | Version | Description                                                                                                                                                             |
| ---------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@midnight-ntwrk/wallet-sdk-facade`            | 1.0.0   | Unified API that orchestrates shielded, unshielded, and dust wallets. Handles transaction balancing, transfers, and swaps through a single interface.                   |
| `@midnight-ntwrk/wallet-sdk-unshielded-wallet` | 1.0.0   | Manages Night and other unshielded tokens. Tracks UTxOs, creates offers for swaps, and provides inputs/outputs for transaction balancing.                               |
| `@midnight-ntwrk/wallet-sdk-shielded-wallet`   | 1.0.0   | Manages privacy-preserving shielded tokens. Handles ZK proof generation, coin commitment tracking, and encrypted output decryption.                                     |
| `@midnight-ntwrk/wallet-sdk-dust-wallet`       | 1.0.0   | Manages Dust for transaction fees. Handles Dust designation, balance tracking, and automatic fee payment during transaction balancing.                                  |
| `@midnight-ntwrk/wallet-sdk-hd`                | 3.0.0   | Derives cryptographic keys from a seed following BIP-32/BIP-44/CIP-1852. Generates keys for unshielded (secp256k1), shielded (JubJub), and Dust (BLS12-381) operations. |
| `@midnight-ntwrk/wallet-sdk-address-format`    | 3.0.0   | Encodes and decodes Midnight addresses using Bech32m format. Supports payment addresses, shielded addresses, and Dust addresses with network identifiers.               |
| `@midnight-ntwrk/wallet-sdk-node-client`       | 1.0.0   | Communicates with Midnight nodes. Submits transactions and queries blockchain state.                                                                                    |
| `@midnight-ntwrk/wallet-sdk-indexer-client`    | 1.0.0   | Queries the Midnight indexer via GraphQL over websocket. Retrieves UTxOs, events and block information.                                                                 |
| `@midnight-ntwrk/wallet-sdk-prover-client`     | 1.0.0   | Interfaces with the prover service to generate zero-knowledge proofs for shielded transactions and Dust spends.                                                         |
| `@midnight-ntwrk/wallet-sdk-runtime`           | 1.0.0   | Orchestrates wallet lifecycle and state management. Supports version migration for protocol upgrades.                                                                   |
| `@midnight-ntwrk/wallet-sdk-capabilities`      | 3.0.0   | Shared wallet features including coin selection algorithms and transaction balancing logic.                                                                             |
| `@midnight-ntwrk/wallet-sdk-abstractions`      | 1.0.0   | Core interfaces and domain types used across all packages.                                                                                                              |
| `@midnight-ntwrk/wallet-sdk-utilities`         | 1.0.0   | Common utilities for serialization, networking, and testing.                                                                                                            |

---

### Links and references

- SDK Documentation: [link-to-docs]
- Examples: [packages/docs-snippets](packages/docs-snippets)
- GitHub Repository: [midnightntwrk/midnight-wallet](https://github.com/midnightntwrk/midnight-wallet)
- DApp Connector API:
  [midnightntwrk/midnight-dapp-connector-api](https://github.com/midnightntwrk/midnight-dapp-connector-api)

---

### Fixed defect list

N/A - Initial release.
