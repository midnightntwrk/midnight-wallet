# Midnight Wallet SDK - Release Notes

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
