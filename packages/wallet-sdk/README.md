# @midnight-ntwrk/wallet-sdk

Barrel package for the Midnight Wallet SDK. Instead of installing and importing from multiple
`@midnight-ntwrk/wallet-sdk-*` packages individually, this package re-exports them all through a single dependency with
multiple entry points.

## Installation

```bash
npm install @midnight-ntwrk/wallet-sdk
```

## Overview

This package provides a unified installation and import experience for the Midnight Wallet SDK. The main entry point
re-exports the core wallet types, while dedicated sub-path exports give access to each underlying package:

| Entry Point                                                   | Re-exports                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@midnight-ntwrk/wallet-sdk`                                  | Flat: abstractions, address-format, dust-wallet, facade, hd, prover-client, shielded, unshielded-wallet, utilities. Namespaced: `Capabilities` (capabilities), `IndexerClient` (indexer-client), `NodeClient` (node-client), `Runtime` (runtime). |
| `@midnight-ntwrk/wallet-sdk/address-format`                   | `@midnight-ntwrk/wallet-sdk-address-format`                                                                                                                                                                                                       |
| `@midnight-ntwrk/wallet-sdk/capabilities`                     | `@midnight-ntwrk/wallet-sdk-capabilities`                                                                                                                                                                                                         |
| `@midnight-ntwrk/wallet-sdk/capabilities/balancer`            | `@midnight-ntwrk/wallet-sdk-capabilities/balancer`                                                                                                                                                                                                |
| `@midnight-ntwrk/wallet-sdk/capabilities/pendingTransactions` | `@midnight-ntwrk/wallet-sdk-capabilities/pendingTransactions`                                                                                                                                                                                     |
| `@midnight-ntwrk/wallet-sdk/capabilities/proving`             | `@midnight-ntwrk/wallet-sdk-capabilities/proving`                                                                                                                                                                                                 |
| `@midnight-ntwrk/wallet-sdk/capabilities/simulation`          | `@midnight-ntwrk/wallet-sdk-capabilities/simulation`                                                                                                                                                                                              |
| `@midnight-ntwrk/wallet-sdk/capabilities/submission`          | `@midnight-ntwrk/wallet-sdk-capabilities/submission`                                                                                                                                                                                              |
| `@midnight-ntwrk/wallet-sdk/dust`                             | `@midnight-ntwrk/wallet-sdk-dust-wallet`                                                                                                                                                                                                          |
| `@midnight-ntwrk/wallet-sdk/dust/v1`                          | `@midnight-ntwrk/wallet-sdk-dust-wallet/v1`                                                                                                                                                                                                       |
| `@midnight-ntwrk/wallet-sdk/facade`                           | `@midnight-ntwrk/wallet-sdk-facade`                                                                                                                                                                                                               |
| `@midnight-ntwrk/wallet-sdk/hd`                               | `@midnight-ntwrk/wallet-sdk-hd`                                                                                                                                                                                                                   |
| `@midnight-ntwrk/wallet-sdk/indexer-client`                   | `@midnight-ntwrk/wallet-sdk-indexer-client`                                                                                                                                                                                                       |
| `@midnight-ntwrk/wallet-sdk/indexer-client/effect`            | `@midnight-ntwrk/wallet-sdk-indexer-client/effect`                                                                                                                                                                                                |
| `@midnight-ntwrk/wallet-sdk/node-client`                      | `@midnight-ntwrk/wallet-sdk-node-client`                                                                                                                                                                                                          |
| `@midnight-ntwrk/wallet-sdk/node-client/effect`               | `@midnight-ntwrk/wallet-sdk-node-client/effect`                                                                                                                                                                                                   |
| `@midnight-ntwrk/wallet-sdk/node-client/testing`              | `@midnight-ntwrk/wallet-sdk-node-client/testing`                                                                                                                                                                                                  |
| `@midnight-ntwrk/wallet-sdk/prover-client`                    | `@midnight-ntwrk/wallet-sdk-prover-client`                                                                                                                                                                                                        |
| `@midnight-ntwrk/wallet-sdk/prover-client/effect`             | `@midnight-ntwrk/wallet-sdk-prover-client/effect`                                                                                                                                                                                                 |
| `@midnight-ntwrk/wallet-sdk/proving`                          | Legacy alias for `@midnight-ntwrk/wallet-sdk/capabilities/proving`                                                                                                                                                                                |
| `@midnight-ntwrk/wallet-sdk/runtime`                          | `@midnight-ntwrk/wallet-sdk-runtime`                                                                                                                                                                                                              |
| `@midnight-ntwrk/wallet-sdk/runtime/abstractions`             | `@midnight-ntwrk/wallet-sdk-runtime/abstractions`                                                                                                                                                                                                 |
| `@midnight-ntwrk/wallet-sdk/shielded`                         | `@midnight-ntwrk/wallet-sdk-shielded`                                                                                                                                                                                                             |
| `@midnight-ntwrk/wallet-sdk/shielded/v1`                      | `@midnight-ntwrk/wallet-sdk-shielded/v1`                                                                                                                                                                                                          |
| `@midnight-ntwrk/wallet-sdk/testing`                          | Legacy alias for `@midnight-ntwrk/wallet-sdk/utilities/testing`                                                                                                                                                                                   |
| `@midnight-ntwrk/wallet-sdk/unshielded`                       | `@midnight-ntwrk/wallet-sdk-unshielded-wallet`                                                                                                                                                                                                    |
| `@midnight-ntwrk/wallet-sdk/unshielded/v1`                    | `@midnight-ntwrk/wallet-sdk-unshielded-wallet/v1`                                                                                                                                                                                                 |
| `@midnight-ntwrk/wallet-sdk/utilities`                        | `@midnight-ntwrk/wallet-sdk-utilities`                                                                                                                                                                                                            |
| `@midnight-ntwrk/wallet-sdk/utilities/networking`             | `@midnight-ntwrk/wallet-sdk-utilities/networking`                                                                                                                                                                                                 |
| `@midnight-ntwrk/wallet-sdk/utilities/testing`                | `@midnight-ntwrk/wallet-sdk-utilities/testing`                                                                                                                                                                                                    |
| `@midnight-ntwrk/wallet-sdk/utilities/types`                  | `@midnight-ntwrk/wallet-sdk-utilities/types`                                                                                                                                                                                                      |

The Wallet Facade (`WalletFacade`) provides a high-level unified interface that aggregates the functionality of all
wallet types (shielded, unshielded, and dust). It simplifies wallet operations by providing:

- Combined state management across all wallet types
- Unified transaction balancing for shielded, unshielded, and dust
- Coordinated transfer and swap operations
- Simplified transaction finalization flow
- Dust registration management

## Usage

### Initializing the Facade

```typescript
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk';

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
