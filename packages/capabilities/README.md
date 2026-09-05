# @midnightntwrk/wallet-sdk-capabilities

Internal wallet capabilities for transaction balancing on the Midnight network.

## Installation

```bash
npm install @midnightntwrk/wallet-sdk-capabilities
```

## Overview

This package provides core transaction balancing capabilities used internally by wallet implementations. It handles the
complex logic of selecting inputs and creating outputs to balance transactions while accounting for fee overhead costs.

Key features:

- Transaction balancing algorithms
- Coin selection strategies
- Imbalance tracking and resolution
- Fee-aware counter-offer generation

## Usage

### Basic Transaction Balancing

```typescript
import { getBalanceRecipe, Imbalances, chooseCoin } from '@midnightntwrk/wallet-sdk-capabilities';

const recipe = getBalanceRecipe({
  coins: availableCoins,
  initialImbalances: Imbalances.fromEntry('NIGHT', -1000n), // Need 1000 NIGHT
  transactionCostModel: {
    inputFeeOverhead: 1000n,
    outputFeeOverhead: 500n,
  },
  feeTokenType: 'DUST',
  createOutput: (coin) => ({ type: coin.type, value: coin.value }),
  isCoinEqual: (a, b) => a.id === b.id,
  coinSelection: chooseCoin, // Optional: defaults to smallest-first selection
});

console.log('Inputs to add:', recipe.inputs);
console.log('Outputs to create:', recipe.outputs);
```

### Working with Imbalances

```typescript
import { Imbalances } from '@midnightntwrk/wallet-sdk-capabilities';

// Create imbalances from entries
const imbalances = Imbalances.fromEntries([
  ['NIGHT', -500n], // Need 500 NIGHT (negative = deficit)
  ['TOKEN_A', 200n], // Have 200 TOKEN_A excess (positive = surplus)
]);

// Merge imbalances
const merged = Imbalances.merge(imbalances1, imbalances2);

// Get value for a token type
const nightImbalance = Imbalances.getValue(imbalances, 'NIGHT');
```

### Custom Coin Selection

```typescript
import { getBalanceRecipe, CoinSelection } from '@midnightntwrk/wallet-sdk-capabilities';

// Custom strategy: prefer larger coins
const largestFirst: CoinSelection<MyCoin> = (coins, tokenType, amountNeeded, costModel) => {
  return coins
    .filter((coin) => coin.type === tokenType)
    .sort((a, b) => Number(b.value - a.value))
    .at(0);
};

const recipe = getBalanceRecipe({
  // ... other options
  coinSelection: largestFirst,
});
```

### Error Handling

```typescript
import { getBalanceRecipe, InsufficientFundsError } from '@midnightntwrk/wallet-sdk-capabilities';

try {
  const recipe = getBalanceRecipe({/* ... */});
} catch (error) {
  if (error instanceof InsufficientFundsError) {
    console.log(`Cannot balance: insufficient ${error.tokenType}`);
  }
}
```

### Proving, either side of a protocol boundary

A proving backend is written against one ledger version — it drives that version's `Transaction.prove` with that
version's cost model, and frames its proof-server requests with that version's payload helpers. Backends are therefore
named per ledger version, keyed the way `forks` is, and the range each serves is read off the same fork schedule the
wallets are built with:

```typescript
import { makeDefaultVersionedProvingService } from '@midnightntwrk/wallet-sdk-capabilities/proving';

const service = makeDefaultVersionedProvingService(
  { provers: { v8: { kind: 'server', url: v8ProofServer }, v9: { kind: 'wasm' } } },
  forks,
); // Either<VersionedProvingService, ProvingConfigurationError>
```

- `provers` wins over `provingServerUrl`; naming neither is a `ProvingConfigurationError`. `v9` is required and `v8` is
  optional: a version below `forks.v9` with no `v8` backend fails with `UnsupportedProvingVersionError`.
- `provingServerUrl` is one server under every key, driven by each ledger version on its own side of `forks.v9`. That is
  what makes the single-URL form frame correctly on both sides; whether one server can actually prove both is an
  operational fact about that server, not something the SDK enforces.
- Each registered backend refuses the other ledger version's transaction with `ProvingEpochMismatchError` rather than
  handing it to a ledger that cannot read it.
- `makeServerProvingServiceEffect` / `makeWasmProvingServiceEffect` build a single current-ledger backend;
  `makeV8ServerProvingServiceEffect` / `makeV8WasmProvingServiceEffect` are their ledger-v8 twins.

## Exports

### Balancer

- `getBalanceRecipe` - Main function to calculate inputs/outputs needed to balance a transaction
- `createCounterOffer` - Creates counter offers with cost model awareness
- `chooseCoin` - Default coin selection strategy (smallest coin first)
- `InsufficientFundsError` - Error thrown when balancing fails due to insufficient funds
- `BalanceRecipe` - Type for balance result with inputs and outputs
- `CoinSelection` - Type for coin selection function

### Imbalances

- `Imbalances` - Utilities for creating and manipulating token imbalance maps
- `Imbalance` - Type representing a single token imbalance `[TokenType, TokenValue]`
- `TokenType` - String type alias for token identifiers
- `TokenValue` - Bigint type alias for token amounts
- `CoinRecipe` - Interface for basic coin structure with `type` and `value`

### CounterOffer

- `CounterOffer` - Class for building balanced transactions with fee awareness
- `TransactionCostModel` - Interface defining `inputFeeOverhead` and `outputFeeOverhead`

## License

Apache-2.0
