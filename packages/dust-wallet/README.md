# @midnightntwrk/wallet-sdk-dust-wallet

Manages dust (transaction fees) on the Midnight network.

## Installation

```bash
npm install @midnightntwrk/wallet-sdk-dust-wallet
```

## Overview

The Dust Wallet handles dust operations on the Midnight network. Dust is required to pay transaction fees. This package
provides:

- Dust coin management and tracking
- Balance synchronization with the network
- Transaction fee calculation
- Dust generation from Night UTXOs
- Fee balancing for transactions

## Usage

### Starting the Wallet

```typescript
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';

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
// Calculate the fee for a transaction only (does not include the balancing transaction fee)
const fee = await dustWallet.calculateFee([transaction]);

// Estimate the total fee including the balancing transaction fee
// ttl and currentTime are optional (default: 1 hour from now, and current block timestamp)
const totalFee = await dustWallet.estimateFee(dustSecretKey, [transaction]);

// With explicit ttl and currentTime
const totalFeeWithOptions = await dustWallet.estimateFee(dustSecretKey, [transaction], ttl, currentTime);
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
- Current (ledger-v9) variant internals via `@midnightntwrk/wallet-sdk-dust-wallet/v2`
- Pre-fork (ledger-v8) variant internals via `@midnightntwrk/wallet-sdk-dust-wallet/v1`

## V2 Builder

Use the V2 builder pattern for wallet construction:

```typescript
import { V2Builder, RunningV2Variant } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';

// Build a V2 dust wallet variant
```

## Sync: the pre-fork variant replays events, permanently

The two variants do not offer the same synchronisation options, and this is not a temporary gap.

`./v2` (ledger-v9) can sync either way: by replaying the indexer's dust ledger events, or through the projections-based
**eventless fast sync** (`makeEventLessSyncService` / `makeEventLessSyncCapability`).

`./v1` (ledger-v8) offers **event replay only** — the same mechanism the shipped 1.x wallet uses in production today. It
does not export the projection schema types, the `DustProjectionsUpdate` union, or the eventless sync service and
capability. The reason is the ledger, not the wallet: the eventless path is built on four `DustLocalState` members that
exist only in ledger-v9, and no published ledger-v8 (checked through 8.1.1, the latest) has any of them —

| Member                             | Used for                                                     |
| ---------------------------------- | ------------------------------------------------------------ |
| `updateGenerationTreeFromEvidence` | applying generation-tree dtime updates from indexer evidence |
| `commitmentTreeFirstFree`          | placing commitments relative to collapsed-tree updates       |
| `generatingTreeFirstFree`          | the same, for the generation tree                            |
| `nullifiers`                       | resolving which dust UTxOs a projection has already spent    |

There is no v8-compatible implementation of them anywhere, so the path cannot be back-ported. **Decided 2026-08-19: the
pre-fork variant keeps event-replay sync permanently; no ledger change is being requested to close this.**

Everything else in `./v1` does track the current variant with the ledger swapped — including the sync lock, the one-shot
`sync` entry point, and typed (non-defect) `blockData` failures.

## License

Apache-2.0
