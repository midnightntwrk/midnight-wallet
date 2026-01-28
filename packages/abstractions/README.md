# @midnight-ntwrk/wallet-sdk-abstractions

Domain-specific abstractions for the Midnight Wallet SDK.

## Installation

```bash
npm install @midnight-ntwrk/wallet-sdk-abstractions
```

## Overview

This package provides core types and interfaces used throughout the Midnight Wallet SDK. It defines the fundamental
abstractions for:

- Network identification
- Protocol state and versioning
- Wallet seeds and state management
- Transaction serialization

## Exports

### NetworkId

Network identifier types for distinguishing between different Midnight networks (e.g., mainnet, testnet).

### ProtocolState

Types representing the current state of the Midnight protocol.

### ProtocolVersion

Version information for protocol compatibility.

### WalletSeed

Abstractions for wallet seed management and derivation.

### WalletState

Types representing the internal state of a wallet instance.

### SerializedTransaction

Types for serialized transaction data that can be stored or transmitted.

### SerializedUnprovenTransaction

Types for unproven transaction serialization before ZK proofs are generated.

## License

Apache-2.0
