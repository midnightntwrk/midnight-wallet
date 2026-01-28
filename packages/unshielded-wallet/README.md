# @midnight-ntwrk/wallet-sdk-unshielded-wallet

Manages unshielded tokens on the Midnight network.

## Installation

```bash
npm install @midnight-ntwrk/wallet-sdk-unshielded-wallet
```

## Overview

The Unshielded Wallet handles transparent token operations where transactions are publicly visible on the blockchain.
Unlike shielded transactions, unshielded operations do not use zero-knowledge proofs. This package provides:

- Public token balance tracking
- Transparent transfer transactions
- Transaction balancing for unshielded tokens
- Swap initialization and participation
- Transaction signing

## Usage

### Starting the Wallet

```typescript
import {
  UnshieldedWallet,
  createKeystore,
  PublicKey,
  InMemoryTransactionHistoryStorage,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { randomBytes } from 'node:crypto';

// Configuration for the wallet
const configuration = {
  networkId: 'testnet', // or 'mainnet', 'undeployed'
  indexerUrl: 'ws://localhost:8088/api/v3/graphql/ws',
  txHistoryStorage: new InMemoryTransactionHistoryStorage(),
};

// Create a keystore from a random unshielded seed
const seed = randomBytes(32);
const keystore = createKeystore(seed, configuration.networkId);

// Create and start the wallet
const unshieldedWallet = UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keystore));

// Start syncing with the network
await unshieldedWallet.start();
```

### Restoring from Serialized State

```typescript
// Restore a wallet from previously serialized state
const unshieldedWallet = UnshieldedWallet(configuration).restore(serializedState);
await unshieldedWallet.start();
```

### Observing State

```typescript
unshieldedWallet.state.subscribe((state) => {
  console.log('Progress:', state.progress);
  console.log('Balances:', state.balances);
});

// Or wait for sync
const syncedState = await unshieldedWallet.waitForSyncedState();
```

### Creating Transfer Transactions

```typescript
const tx = await unshieldedWallet.transferTransaction(
  [{ type: 'TOKEN_A', receiverAddress: '...', amount: 1000n }],
  ttl,
);
```

### Balancing Transactions

```typescript
// Balance a finalized transaction
const balancingTx = await unshieldedWallet.balanceFinalizedTransaction(finalizedTx);

// Balance an unbound transaction (in-place)
const balancedTx = await unshieldedWallet.balanceUnboundTransaction(unboundTx);

// Balance an unproven transaction (in-place)
const balancedUnprovenTx = await unshieldedWallet.balanceUnprovenTransaction(unprovenTx);
```

### Signing Transactions

```typescript
// Sign an unproven transaction
const signedTx = await unshieldedWallet.signUnprovenTransaction(tx, signSegment);

// Sign an unbound transaction
const signedUnboundTx = await unshieldedWallet.signUnboundTransaction(tx, signSegment);
```

### Creating Swap Offers

```typescript
const swapTx = await unshieldedWallet.initSwap(
  { TOKEN_A: 500n }, // inputs
  [{ type: 'TOKEN_B', receiverAddress, amount: 100n }], // outputs
  ttl,
);
```

## Exports

- `UnshieldedWallet` - Main wallet class
- `UnshieldedWalletState` - Wallet state type
- `KeyStore` - Key storage utilities
- Storage utilities for persistence

## License

Apache-2.0
