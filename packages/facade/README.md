# @midnightntwrk/wallet-sdk-facade

> **Note:** It is recommended to use the [`@midnightntwrk/wallet-sdk`](../wallet-sdk/README.md) barrel package, which
> re-exports this and all other wallet SDK packages through a single dependency.

Unified facade for the Midnight Wallet SDK that combines all wallet types into a single API.

## Installation

```bash
npm install @midnightntwrk/wallet-sdk-facade
```

## Overview

The Wallet Facade provides a high-level unified interface that aggregates the functionality of all wallet types
(shielded, unshielded, and dust). It simplifies wallet operations by providing:

- Combined state management across all wallet types
- Unified transaction balancing for shielded, unshielded, and dust
- Coordinated transfer and swap operations
- Simplified transaction finalization flow
- Dust registration management

## Usage

More detailed and complete examples can be found at [docs snippets](../docs-snippets/src/snippets) (always up-to-date
with the recent changes) or at the
[SDK documentation site](https://docs.midnight.network/sdks/official/wallet-developer-guide) (aligned with the recent
release)

### Initializing the Facade

```typescript
import { WalletFacade } from '@midnightntwrk/wallet-sdk-facade';

const facade = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);

// Start all wallets
await facade.start(shieldedSecretKeys, dustSecretKey);
```

### Configuring where proving happens

A transaction is proved by the backend registered for the protocol version its own bytes were authored at, never by the
version the chain has since reached. Backends are named ascending by the version each starts serving:

```typescript
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';

const configuration = {
  // ... the rest of the wallet configuration, including `forkVersion`
  provers: [
    // Below the boundary: a proof server built against ledger-v8.
    {
      sinceVersion: ProtocolVersion.MinSupportedVersion,
      backend: { kind: 'server', url: new URL('http://localhost:6301') },
    },
    // From the boundary: proving in this process, with the published circuits.
    { sinceVersion: forkVersion, backend: { kind: 'wasm' } },
  ],
};
```

Two shorthands remain: `provingServers: [{ sinceVersion, url }]` is the same list with every entry a server, and
`provingServerUrl: url` is one server for every version. Both are read only when `provers` is absent.

A backend whose range spans `configuration.forkVersion` — which `provingServerUrl` always does — is split at the
boundary and driven by each ledger version in turn, so the same description means the right thing on both sides. A proof
server, though, is built against one ledger version: no published image serves both, so a chain with history below the
boundary wants an entry per side. The in-process prover works on bytes and does serve both.

A version no backend covers fails with `UnsupportedProvingVersionError`, naming the version.

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
