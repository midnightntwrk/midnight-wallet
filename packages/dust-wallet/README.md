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
import * as ledgerV8 from '@midnightntwrk/ledger-v8';
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

On a chain that crossed `forks.v9` with ledger-v8 history behind it, a new wallet skips that history by default. A
wallet that crosses the boundary discards the state it built from that history, so replaying it only costs time.

A fresh start searches the indexer for the last dust event below `forks.v9` and starts the V2 variant there, with the
empty state a wallet crossing the boundary is handed. From there it syncs by event replay as usual.

To replay the ledger-v8 dust history anyway, set `skipLedgerV8DustHistory` to `false`:

```typescript
const dustWallet = await DustWallet({ ...configuration, skipLedgerV8DustHistory: false }).startWithSeed(seed);
await dustWallet.start(keys);
```

- **The wallet's ledger-v8 dust transaction history will be missing** when the history is skipped, because no event
  below the boundary is applied.
- Fresh starts only: a restored wallet resumes from the cursor its snapshot carries.
- Its dust is valued against the configured `dustParameters`, as a wallet crossing the boundary values it, and not
  against dust parameters passed to the start.
- Best-effort: on a chain still below `forks.v9`, one born on ledger-v9, or with an indexer that cannot be searched, the
  wallet starts where it would with the option set to `false`, after the search. So does a search that takes longer than
  `dustTimelineStartTimeout` (2 minutes by default; zero skips the search). A search that times out is not cancelled: it
  finishes in the background and its answer is ignored.
- The search runs before every fresh start: two indexer lookups on a chain born on ledger-v9, ten seconds on a chain
  with no dust event yet, and up to `dustTimelineStartTimeout` with a slow indexer. A local chain that starts many
  wallets before it has any dust is better off with `skipLedgerV8DustHistory: false`.
- Dust only. The shielded and unshielded wallets have to read ledger-v8 to find the coins they hold from it.
- A `CustomForkingDustWallet` composition does not search unless it sets `dustTimelineStartProbe`, either by spreading
  `dustWalletProbes(configuration)` into its configuration or directly, for example to
  `() => Effect.runPromise(SyncService.findDustTimelineStart(configuration, configuration.forks.v9))`, with
  `SyncService` from `/v2`; the answer is a `DustWalletTypes.DustTimelineStart`. The start builds its state with the
  composition's own V2 migration, so it is valued against the dust parameters that migration is built on, as a wallet
  crossing the boundary is.

### Observing State

```typescript
dustWallet.state.subscribe((state) => {
  console.log('Progress:', state.progress);
  console.log('Balance:', state.balance(new Date()));
  console.log('Dust Address:', state.address);
});

// Or wait for sync
const syncedState = await dustWallet.waitForSyncedState();
```

### Balancing Transaction Fees

```typescript
// Add fee balancing to a transaction; `blockData` describes the block it was priced at.
// Without a `currentTime`, this may wait up to two minutes for the wallet's Dust trees to reach a recent block, then
// fails with a `Wallet.Sync` error.
const { transaction: feeBalancingTx, blockData } = await dustWallet.balanceTransactions([transactionToBalance], ttl);
```

### Calculating Fees

```typescript
// Calculate the fee for a transaction only (does not include the balancing transaction fee)
const fee = await dustWallet.calculateFee([transaction]);

// Estimate the total fee including the balancing transaction fee
// ttl and currentTime are optional (default: 1 hour from now, and current block timestamp)
const totalFee = await dustWallet.estimateFee([transaction]);

// With explicit ttl and currentTime
const totalFeeWithOptions = await dustWallet.estimateFee([transaction], ttl, currentTime);
```

### Dust Generation

Register Night UTXOs to generate dust:

```typescript
// currentTime may be undefined, to use the latest block's timestamp
const dustGenerationTx = await dustWallet.createDustGenerationTransaction(
  currentTime,
  ttl,
  nightUtxos,
  nightVerifyingKey,
  dustReceiverAddress,
);

// Add signature for dust registration
const signedTx = await dustWallet.addDustGenerationSignature(dustGenerationTx, signature);
```

## Exports

- `DustWallet` - The wallet, running the V1 variant below `forks.v9` and the V2 variant from it
- `CustomDustWallet` - A wallet composed from one variant's builder
- `DustWalletState` - Wallet state
- `DustWalletTypes` - The data both variants speak, and the capability contracts they implement
- V2 (ledger-v9) variant internals via `@midnightntwrk/wallet-sdk-dust-wallet/v2`, and V1 (ledger-v8) ones via
  `@midnightntwrk/wallet-sdk-dust-wallet/v1`: `CoreWallet`, `Keys`, `CoinsAndBalances`, `SyncService`, `Transacting`,
  and `Simulator`, that ledger version's simulator

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

Everything else in `./v1` tracks the V2 variant with the ledger swapped, including the sync lock and typed (non-defect)
`blockData` failures, except the one-shot `sync` entry point: the V1 variant synchronizes in the background only,
because the one sync service the SDK ships that runs in finite passes, the projections one, needs ledger-v9.

## License

Apache-2.0
