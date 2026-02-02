# @midnight-ntwrk/wallet-sdk-facade

Unified facade for the Midnight Wallet SDK that combines all wallet types into a single API.

## Installation

```bash
npm install @midnight-ntwrk/wallet-sdk-facade
```

## Overview

The Wallet Facade provides a high-level unified interface that aggregates the functionality of all wallet types
(shielded, unshielded, and dust). It simplifies wallet operations by providing:

- Combined state management across all wallet types
- Unified transaction balancing for shielded, unshielded, and dust tokens
- Coordinated transfer and swap operations
- Simplified transaction finalization flow
- Dust registration management

## Usage

### Initializing the Facade

```typescript
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';

const facade = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);

// Start all wallets
await facade.start(shieldedSecretKeys, dustSecretKey);
```

### Observing Combined State

```typescript
facade.state().subscribe((state) => {
  console.log('Shielded:', state.shielded);
  console.log('Unshielded:', state.unshielded);
  console.log('Dust:', state.dust);
  console.log('All synced:', state.isSynced);
});

// Or wait for full sync
const syncedState = await facade.waitForSyncedState();
```

### Creating Transfer Transactions

```typescript
const recipe = await facade.transferTransaction(
  [
    {
      type: 'shielded',
      outputs: [{ type: 'TOKEN_B', receiverAddress: shieldedAddr, amount: 1000n }],
    },
    {
      type: 'unshielded',
      outputs: [{ type: 'TOKEN_A', receiverAddress: unshieldedAddr, amount: 500n }],
    },
  ],
  { shieldedSecretKeys, dustSecretKey },
  { ttl: new Date(Date.now() + 3600000) },
);
```

### Balancing Transactions

```typescript
// Balance a finalized transaction
const recipe = await facade.balanceFinalizedTransaction(
  finalizedTx,
  { shieldedSecretKeys, dustSecretKey },
  { ttl, tokenKindsToBalance: 'all' }, // or ['shielded', 'dust']
);

// Finalize the balanced recipe
const finalTx = await facade.finalizeRecipe(recipe);

// Submit to the network
const txId = await facade.submitTransaction(finalTx);
```

### Creating Swap Offers

```typescript
const swapRecipe = await facade.initSwap(
  { shielded: { NIGHT: 1000n } }, // inputs
  [{ type: 'shielded', outputs: [{ type: 'TOKEN_A', receiverAddress, amount: 100n }] }], // outputs
  { shieldedSecretKeys, dustSecretKey },
  { ttl, payFees: false },
);
```

### Dust Registration

```typescript
// Register Night UTXOs for dust generation
const registrationRecipe = await facade.registerNightUtxosForDustGeneration(
  nightUtxos,
  nightVerifyingKey,
  signDustRegistration,
);

// Estimate registration costs
const { fee, dustGenerationEstimations } = await facade.estimateRegistration(nightUtxos);
```

## Types

### BalancingRecipe

The facade returns different recipe types depending on the input transaction:

- `FinalizedTransactionRecipe` - For finalized transactions
- `UnboundTransactionRecipe` - For unbound transactions
- `UnprovenTransactionRecipe` - For unproven transactions

### TokenKindsToBalance

Control which token types to balance:

```typescript
type TokenKindsToBalance = 'all' | ('dust' | 'shielded' | 'unshielded')[];
```

## License

Apache-2.0
