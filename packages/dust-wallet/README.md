# @midnight-ntwrk/wallet-sdk-dust-wallet

Manages dust tokens (transaction fees) on the Midnight network.

## Installation

```bash
npm install @midnight-ntwrk/wallet-sdk-dust-wallet
```

## Overview

The Dust Wallet handles dust operations on the Midnight network. Dust tokens are required to pay transaction fees. This
package provides:

- Dust coin management and tracking
- Balance synchronization with the network
- Transaction fee calculation
- Dust generation from Night UTXOs
- Fee balancing for transactions

## Usage

### Starting the Wallet

```typescript
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';

await dustWallet.start(dustSecretKey);
```

### Observing State

```typescript
dustWallet.state.subscribe((state) => {
  console.log('Progress:', state.state.progress);
  console.log('Balance:', state.state.balance);
  console.log('Dust Address:', state.dustAddress);
});

// Or wait for sync
const syncedState = await dustWallet.waitForSyncedState();
```

### Balancing Transaction Fees

```typescript
// Add fee balancing to a transaction
const feeBalancingTx = await dustWallet.balanceTransactions(dustSecretKey, [transactionToBalance], ttl);
```

### Calculating Fees

```typescript
const fee = await dustWallet.calculateFee([transaction]);
```

### Dust Generation

Register Night UTXOs to generate dust:

```typescript
const dustGenerationTx = await dustWallet.createDustGenerationTransaction(
  previousState,
  ttl,
  nightUtxos,
  nightVerifyingKey,
  dustReceiverAddress,
);

// Add signature for dust registration
const signedTx = await dustWallet.addDustGenerationSignature(dustGenerationTx, signature);
```

## Exports

- `DustWallet` - Main wallet class
- `DustWalletState` - Wallet state type
- `DustCoreWallet` - Core wallet implementation
- `Keys` - Key management utilities
- `Simulator` - Dust simulation utilities
- `SyncService` - Synchronization service
- `Transacting` - Transaction utilities
- `CoinsAndBalances` - Coin and balance management

## V1 Builder

Use the V1 builder pattern for wallet construction:

```typescript
import { V1Builder, RunningV1Variant } from '@midnight-ntwrk/wallet-sdk-dust-wallet';

// Build a V1 dust wallet variant
```

## License

Apache-2.0
