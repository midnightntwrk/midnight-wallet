# @midnight-ntwrk/wallet-sdk-capabilities

Internal wallet capabilities for transaction balancing on the Midnight network.

## Installation

```bash
npm install @midnight-ntwrk/wallet-sdk-capabilities
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
import { getBalanceRecipe, Imbalances, chooseCoin } from '@midnight-ntwrk/wallet-sdk-capabilities';

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
import { Imbalances } from '@midnight-ntwrk/wallet-sdk-capabilities';

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
import { getBalanceRecipe, CoinSelection } from '@midnight-ntwrk/wallet-sdk-capabilities';

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
import { getBalanceRecipe, InsufficientFundsError } from '@midnight-ntwrk/wallet-sdk-capabilities';

try {
  const recipe = getBalanceRecipe({
    /* ... */
  });
} catch (error) {
  if (error instanceof InsufficientFundsError) {
    console.log(`Cannot balance: insufficient ${error.tokenType}`);
  }
}
```

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
