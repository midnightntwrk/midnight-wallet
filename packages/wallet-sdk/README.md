# @midnightntwrk/wallet-sdk

Barrel package for the Midnight Wallet SDK. Instead of installing and importing from multiple
`@midnightntwrk/wallet-sdk-*` packages individually, this package re-exports them all through a single dependency with
multiple entry points.

## Installation

```bash
npm install @midnightntwrk/wallet-sdk
```

## Overview

This package provides a unified installation and import experience for the Midnight Wallet SDK. The main entry point
re-exports the core wallet types, while dedicated sub-path exports give access to each underlying package:

| Entry Point                                                  | Re-exports                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@midnightntwrk/wallet-sdk`                                  | Flat: abstractions, address-format, dust-wallet, facade, hd, prover-client, shielded, unshielded-wallet, utilities. Namespaced: `Capabilities` (capabilities), `IndexerClient` (indexer-client), `NodeClient` (node-client), `Runtime` (runtime). |
| `@midnightntwrk/wallet-sdk/address-format`                   | `@midnightntwrk/wallet-sdk-address-format`                                                                                                                                                                                                        |
| `@midnightntwrk/wallet-sdk/capabilities`                     | `@midnightntwrk/wallet-sdk-capabilities`                                                                                                                                                                                                          |
| `@midnightntwrk/wallet-sdk/capabilities/balancer`            | `@midnightntwrk/wallet-sdk-capabilities/balancer`                                                                                                                                                                                                 |
| `@midnightntwrk/wallet-sdk/capabilities/pendingTransactions` | `@midnightntwrk/wallet-sdk-capabilities/pendingTransactions`                                                                                                                                                                                      |
| `@midnightntwrk/wallet-sdk/capabilities/proving`             | `@midnightntwrk/wallet-sdk-capabilities/proving`                                                                                                                                                                                                  |
| `@midnightntwrk/wallet-sdk/capabilities/simulation`          | `@midnightntwrk/wallet-sdk-capabilities/simulation`                                                                                                                                                                                               |
| `@midnightntwrk/wallet-sdk/capabilities/submission`          | `@midnightntwrk/wallet-sdk-capabilities/submission`                                                                                                                                                                                               |
| `@midnightntwrk/wallet-sdk/dust`                             | `@midnightntwrk/wallet-sdk-dust-wallet`                                                                                                                                                                                                           |
| `@midnightntwrk/wallet-sdk/dust/v1`                          | `@midnightntwrk/wallet-sdk-dust-wallet/v1` (ledger-v8, the V1 variant)                                                                                                                                                                            |
| `@midnightntwrk/wallet-sdk/dust/v2`                          | `@midnightntwrk/wallet-sdk-dust-wallet/v2` (current, ledger-v9 variant)                                                                                                                                                                           |
| `@midnightntwrk/wallet-sdk/facade`                           | `@midnightntwrk/wallet-sdk-facade`                                                                                                                                                                                                                |
| `@midnightntwrk/wallet-sdk/hd`                               | `@midnightntwrk/wallet-sdk-hd`                                                                                                                                                                                                                    |
| `@midnightntwrk/wallet-sdk/indexer-client`                   | `@midnightntwrk/wallet-sdk-indexer-client`                                                                                                                                                                                                        |
| `@midnightntwrk/wallet-sdk/indexer-client/effect`            | `@midnightntwrk/wallet-sdk-indexer-client/effect`                                                                                                                                                                                                 |
| `@midnightntwrk/wallet-sdk/ledger/v8`                        | `@midnight-ntwrk/ledger-v8` (ledger-v8, for authors — see [Authoring transactions](#authoring-transactions))                                                                                                                                      |
| `@midnightntwrk/wallet-sdk/ledger/v9`                        | `@midnightntwrk/ledger-v9` (ledger-v9, for authors — see [Authoring transactions](#authoring-transactions))                                                                                                                                       |
| `@midnightntwrk/wallet-sdk/node-client`                      | `@midnightntwrk/wallet-sdk-node-client`                                                                                                                                                                                                           |
| `@midnightntwrk/wallet-sdk/node-client/effect`               | `@midnightntwrk/wallet-sdk-node-client/effect`                                                                                                                                                                                                    |
| `@midnightntwrk/wallet-sdk/node-client/testing`              | `@midnightntwrk/wallet-sdk-node-client/testing`                                                                                                                                                                                                   |
| `@midnightntwrk/wallet-sdk/prover-client`                    | `@midnightntwrk/wallet-sdk-prover-client`                                                                                                                                                                                                         |
| `@midnightntwrk/wallet-sdk/prover-client/effect`             | `@midnightntwrk/wallet-sdk-prover-client/effect`                                                                                                                                                                                                  |
| `@midnightntwrk/wallet-sdk/proving`                          | Legacy alias for `@midnightntwrk/wallet-sdk/capabilities/proving`                                                                                                                                                                                 |
| `@midnightntwrk/wallet-sdk/runtime`                          | `@midnightntwrk/wallet-sdk-runtime`                                                                                                                                                                                                               |
| `@midnightntwrk/wallet-sdk/runtime/abstractions`             | `@midnightntwrk/wallet-sdk-runtime/abstractions`                                                                                                                                                                                                  |
| `@midnightntwrk/wallet-sdk/shielded`                         | `@midnightntwrk/wallet-sdk-shielded`                                                                                                                                                                                                              |
| `@midnightntwrk/wallet-sdk/shielded/v1`                      | `@midnightntwrk/wallet-sdk-shielded/v1` (ledger-v8, the V1 variant)                                                                                                                                                                               |
| `@midnightntwrk/wallet-sdk/shielded/v2`                      | `@midnightntwrk/wallet-sdk-shielded/v2` (current, ledger-v9 variant)                                                                                                                                                                              |
| `@midnightntwrk/wallet-sdk/testing`                          | Legacy alias for `@midnightntwrk/wallet-sdk/utilities/testing`                                                                                                                                                                                    |
| `@midnightntwrk/wallet-sdk/unshielded`                       | `@midnightntwrk/wallet-sdk-unshielded-wallet`                                                                                                                                                                                                     |
| `@midnightntwrk/wallet-sdk/unshielded/v1`                    | `@midnightntwrk/wallet-sdk-unshielded-wallet/v1` (ledger-v8, the V1 variant)                                                                                                                                                                      |
| `@midnightntwrk/wallet-sdk/unshielded/v2`                    | `@midnightntwrk/wallet-sdk-unshielded-wallet/v2` (current, ledger-v9 variant)                                                                                                                                                                     |
| `@midnightntwrk/wallet-sdk/utilities`                        | `@midnightntwrk/wallet-sdk-utilities`                                                                                                                                                                                                             |
| `@midnightntwrk/wallet-sdk/utilities/networking`             | `@midnightntwrk/wallet-sdk-utilities/networking`                                                                                                                                                                                                  |
| `@midnightntwrk/wallet-sdk/utilities/testing`                | `@midnightntwrk/wallet-sdk-utilities/testing`                                                                                                                                                                                                     |
| `@midnightntwrk/wallet-sdk/utilities/types`                  | `@midnightntwrk/wallet-sdk-utilities/types`                                                                                                                                                                                                       |

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
import { WalletFacade } from '@midnightntwrk/wallet-sdk';

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

### Authoring transactions

Most applications never build a transaction themselves: they ask the wallet for a transfer or a swap and carry what
comes back. An application that _does_ build one — reaching for `Intent.new` or `Transaction.fromParts` — has to choose
which ledger version's rules the bytes follow, and both are shipped here so that choice is made in the import line
rather than by reaching past this package for a ledger of your own:

```typescript
import * as ledger from '@midnightntwrk/wallet-sdk/ledger/v9';
import { WalletTransaction } from '@midnightntwrk/wallet-sdk';

const authored = ledger.Transaction.fromParts(networkId, undefined, undefined, intent);
const handle = WalletTransaction.adopt('Unproven', authored, state.activeProtocolVersion);
```

`adopt` seals what you built into the same handle the wallet's own methods return, stamped with the protocol version you
claim it was built for. The SDK holds you to that claim: a transaction stamped for one side of the protocol boundary is
refused by a wallet acting on the other, with a typed `ProtocolVersionMismatchError`.

**Which subpath to import is a property of the chain, not of this release.** A chain is on ledger-v8 until it forks, and
mainnet is on ledger-v8 until then — so an authoring path that only ever imports `./ledger/v9` compiles cleanly and
**fails at run time on every chain that has not yet crossed**. Read `state.activeProtocolVersion` and author against the
version the chain is actually on; the check is a run-time one by design, because the compiler cannot know which chain
the application will be pointed at.

Neither subpath is re-exported from the package root. They are WebAssembly modules, and an application that only carries
transactions should not pay for a ledger it never names.

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
