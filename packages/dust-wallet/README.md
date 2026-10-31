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
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';

// One ledger version's dust key per side of the boundary, each derived from the dust seed by its own ledger version:
// the wallet reads the chain with whichever side it is on, and keeps the other for the hand-over
const keys = {
  v8: ledgerV8.DustSecretKey.fromSeed(dustSeed),
  v9: ledgerV9.DustSecretKey.fromSeed(dustSeed),
};

const dustWallet = await DustWallet(configuration).startWithKeys(keys);
await dustWallet.start(keys);

// A wallet restored from a snapshot carries no key material, so it is started with its keys again
const restored = DustWallet(configuration).restore(serializedState);
await restored.start(keys);
```

### Starting a New Wallet Without the Ledger-v8 Dust History

On a chain that crossed `forks.v9` with ledger-v8 history behind it, a new wallet can skip that history:

```typescript
const dustWallet = await DustWallet({ ...configuration, skipLedgerV8DustHistory: true }).startWithSeed(seed);
await dustWallet.start(keys);
```

A fresh start then searches the indexer for the last dust event below `forks.v9` and starts the V2 variant there, with
the empty state a wallet crossing the boundary is handed. From there it syncs by event replay as usual.

- **The wallet's ledger-v8 dust transaction history will be missing**, because no event below the boundary is applied.
- Fresh starts only: a restored wallet resumes from the cursor its snapshot carries.
- Its dust is valued against the configured `dustParameters`, as a wallet crossing the boundary values it, and not
  against dust parameters passed to the start.
- Best-effort: a chain still below `forks.v9`, one born on ledger-v9, or an indexer that cannot be searched leaves the
  start as it is without the option.
- Dust only. The shielded and unshielded wallets have to read ledger-v8 to find the coins they hold from it.
- A `CustomForkingDustWallet` composition opts in by setting `dustTimelineStartProbe`, for example to
  `() => Effect.runPromise(findDustTimelineStart(configuration, configuration.forks.v9))`. The start builds its state
  with the composition's own V2 migration, so it is valued against the dust parameters that migration is built on, as a
  wallet crossing the boundary is.

### Observing State

```typescript
dustWallet.state.subscribe((state) => {
  console.log('Progress:', state.progress);
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
- V2 (ledger-v9) variant internals via `@midnightntwrk/wallet-sdk-dust-wallet/v2`
- V1 (ledger-v8) variant internals via `@midnightntwrk/wallet-sdk-dust-wallet/v1`

## V2 Builder

Use the V2 builder pattern for wallet construction:

```typescript
import { V2Builder, RunningV2Variant } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';

// Build a V2 dust wallet variant
```

## Sync: the V1 variant replays events, permanently

The two variants do not offer the same synchronisation options, and this is not a temporary gap.

`./v2` (ledger-v9) can sync either way: by replaying the indexer's dust ledger events, or through the projections-based
**eventless fast sync** (`SyncService.makeEventLessSyncService` / `SyncService.makeEventLessSyncCapability`).

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
V1 variant keeps event-replay sync permanently; no ledger change is being requested to close this.**

Everything else in `./v1` does track the current variant with the ledger swapped — including the sync lock, the one-shot
`sync` entry point, and typed (non-defect) `blockData` failures.

## License

Apache-2.0
