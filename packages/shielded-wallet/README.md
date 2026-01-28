# @midnight-ntwrk/wallet-sdk-shielded

Manages shielded tokens on the Midnight network using zero-knowledge proofs.

## Installation

```bash
npm install @midnight-ntwrk/wallet-sdk-shielded
```

## Overview

The Shielded Wallet handles private token operations where transaction values and addresses are hidden from observers
while maintaining verifiability. It provides:

- Zero-knowledge proof generation
- Coin commitment tracking
- Encrypted output decryption
- Shielded transfer transactions
- Transaction balancing for shielded tokens

## Usage

### Starting the Wallet

```typescript
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { randomBytes } from 'node:crypto';

// Configuration for the wallet
const configuration = {
  networkId: 'preview',
  provingServerUrl: new URL('http://localhost:6300'),
  relayURL: new URL('ws://localhost:9944'),
  indexerClientConnection: {
    indexerHttpUrl: 'http://localhost:8088/api/v3/graphql',
    indexerWsUrl: 'ws://localhost:8088/api/v3/graphql/ws',
  },
};

// Create secret keys from a shielded seed
const seed = randomBytes(32);
const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(seed);

// Create and start the wallet
const shieldedWallet = ShieldedWallet(configuration).startWithSecretKeys(shieldedSecretKeys);

// Start syncing with the network
await shieldedWallet.start(shieldedSecretKeys);
```

### Alternative: Start with Seed Directly

```typescript
// Start directly with a shielded seed
const shieldedWallet = ShieldedWallet(configuration).startWithShieldedSeed(seed);
await shieldedWallet.start(ledger.ZswapSecretKeys.fromSeed(seed));
```

### Restoring from Serialized State

```typescript
// Restore a wallet from previously serialized state
const shieldedWallet = ShieldedWallet(configuration).restore(serializedState);
await shieldedWallet.start(shieldedSecretKeys);
```

### Observing State

```typescript
wallet.state.subscribe((state) => {
  console.log('Progress:', state.state.progress);
  console.log('Coins:', state.state.coins);
});
```

### Creating Transfer Transactions

```typescript
const tx = await wallet.transferTransaction(shieldedSecretKeys, [
  { type: 'NIGHT', receiverAddress: 'mn_shield-addr1...', amount: 1000n },
]);
```

### Balancing Transactions

```typescript
const balancingTx = await wallet.balanceTransaction(shieldedSecretKeys, transactionToBalance);
```

### Finalizing Transactions

```typescript
// Generates ZK proofs and finalizes the transaction
const finalizedTx = await wallet.finalizeTransaction(unprovenTx);
```

### Creating Swap Offers

```typescript
const swapTx = await wallet.initSwap(
  shieldedSecretKeys,
  { NIGHT: 500n }, // inputs
  [{ type: 'TOKEN_A', receiverAddress: shieldedAddress, amount: 100n }], // outputs
);
```

## Privacy Model

Shielded transactions use zero-knowledge proofs to hide:

- Transaction amounts
- Sender addresses
- Receiver addresses

While still proving:

- The sender has sufficient balance
- No tokens are created or destroyed
- The transaction is valid

## Exports

- `ShieldedWallet` - Main wallet class
- `ShieldedWalletState` - Wallet state type
- Version 1 exports via `@midnight-ntwrk/wallet-sdk-shielded/v1`

## License

Apache-2.0
