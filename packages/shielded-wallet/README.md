# @midnightntwrk/wallet-sdk-shielded

Manages shielded tokens on the Midnight network using zero-knowledge proofs.

## Installation

```bash
npm install @midnightntwrk/wallet-sdk-shielded
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
import { ShieldedWallet, V9_NATIVE_FORK_VERSION } from '@midnightntwrk/wallet-sdk-shielded';
import { InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { TransactionHistory } from '@midnightntwrk/wallet-sdk-shielded/v2';
import * as ledger from '@midnightntwrk/ledger-v9';
import { randomBytes } from 'node:crypto';

// Configuration for the wallet
const configuration = {
  networkId: 'preview',
  indexerClientConnection: {
    indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
    indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(TransactionHistory.ShieldedTransactionHistoryEntrySchema),
  // The protocol version this chain hands over to the post-fork ledger at. A 2.x node reports 2000000;
  // the final mainnet fork constant is not yet fixed, so it is supplied per environment.
  forkVersion: V9_NATIVE_FORK_VERSION,
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
const shieldedWallet = ShieldedWallet(configuration).startWithSeed(seed);
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
- Current (ledger-v9) variant internals via `@midnightntwrk/wallet-sdk-shielded/v2`
- Pre-fork (ledger-v8) variant internals via `@midnightntwrk/wallet-sdk-shielded/v1`

## License

Apache-2.0
