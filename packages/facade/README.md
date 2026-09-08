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

### Where the chain forks

Every configuration in the SDK carries `forks`, the protocol version from which each ledger version after the first
reads the chain. The wallet packages require it, because where a chain forks is a fact about the chain. The facade
presets it: left out of the configuration handed to `WalletFacade.init`, `forks` becomes `DefaultForkSchedule` —
`ProtocolVersion.V9NativeForkSchedule`, ledger-v9 from the version a 2.x node reports — and every factory in
`InitParams` is handed the configuration with it filled in, typed `ResolvedConfiguration`. That is why
`shielded: (config) => ShieldedWallet(config)` compiles against a wallet package that requires the field. Code outside a
factory that needs the same configuration — to build a wallet package directly, or to read `forks` back — gets it from
`WalletFacade.resolveConfiguration(configuration)`, and may hand the result to `init` as it is. A chain that hands over
elsewhere states its own `forks`, which wins.

### Configuring where proving happens

A transaction is proved by the backend for the ledger version that authored its bytes, never by the version the chain
has since reached. Backends are named per ledger version, keyed the way `forks` is, and the range each serves is read
off `forks` rather than restated:

```typescript
const configuration = {
  // ... the rest of the wallet configuration; `forks` may be left out, the facade presets `DefaultForkSchedule`
  provers: {
    // Below `forks.v9`: a proof server built against ledger-v8.
    v8: { kind: 'server', url: new URL('http://localhost:6301') },
    // From `forks.v9`: proving in this process, with the published circuits.
    v9: { kind: 'wasm' },
  },
};
```

`v9` is required, because it is what every new transaction is proved with. `v8` may be left out on a chain whose history
below the boundary the wallet never authors for; a transaction stamped there then fails with
`UnsupportedProvingVersionError`, naming the version.

One shorthand remains: `provingServerUrl: url` is one proof server under every key, read only when `provers` is absent.
The SDK drives it with each ledger version on its own side of `forks.v9`, so the same URL frames its requests correctly
on both. A proof server, though, is built against one ledger version: no published image serves both, so a chain with
history below the boundary wants `provers` with a server per side. The in-process prover works on bytes and does serve
both, under both keys.

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
