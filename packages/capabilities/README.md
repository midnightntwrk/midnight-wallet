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

// Either<VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>,
//        ProvingConfigurationError>
const service = makeDefaultVersionedProvingService(
  { provers: { v8: { kind: 'server', url: v8ProofServer }, v9: { kind: 'wasm' } } },
  forks,
);
```

- `provers` wins over `provingServerUrl`; naming neither is a `ProvingConfigurationError`. `v9` is required and `v8` is
  optional: a version below `forks.v9` with no `v8` backend fails with `UnsupportedProvingVersionError`.
- `provingServerUrl` is one server under every key, driven by each ledger version on its own side of `forks.v9`. That is
  what makes the single-URL form frame correctly on both sides; whether one server can actually prove both is an
  operational fact about that server, not something the SDK enforces.
- Each registered backend refuses the other ledger version's transaction with `ProvingEpochMismatchError` rather than
  handing it to a ledger that cannot read it.
- A `server` backend takes `maxConcurrentRequests`, the most requests it has waiting at its proof server at once. It
  defaults to 10, the places a proof server has in its queue as released; a server run with a larger `--job-capacity`
  can be given more (`{ kind: 'server', url, maxConcurrentRequests: 32 }`). `provingServerUrl` always uses the default.
  The cap is per backend, not per proof server: `provingServerUrl` registers its one server as two backends, one per
  ledger version, each with its own cap, so a wallet proving for both ledger versions at once can have twice the cap
  waiting there. A request the server then refuses is sent again.
- `makeV9ServerProvingServiceEffect` / `makeV9WasmProvingServiceEffect` build a single ledger-v9 backend, a
  `V9ProvingServiceEffect` over `V9UnprovenTransaction`; `makeV8ServerProvingServiceEffect` /
  `makeV8WasmProvingServiceEffect` are their ledger-v8 twins (`V8ProvingServiceEffect`, `V8UnprovenTransaction`). The
  facade's `provingService` takes a prover over both ledger versions; to prove with one ledger version's backend alone,
  name it in `provers` (`{ v9: { kind: 'wasm' } }`) instead.
- `makeV9SimulatorProvingServiceEffect` / `makeV8SimulatorProvingServiceEffect` erase proofs instead of proving them,
  for the in-memory simulator.

### Reading a failed submission

A rejected submission does not always mean no block holds the transaction: the node can report a failure after the
transaction is already in a block, or the wait for finality can time out. `classifySubmissionFailure` reads what a
rejection says about inclusion, so a caller releases what the transaction booked (its coins and Dust) only when that is
safe:

```typescript
import { classifySubmissionFailure, SubmissionFailure } from '@midnightntwrk/wallet-sdk-capabilities/submission';

await submission.submitTransaction(tx, 'Finalized').catch(async (rejection: unknown) => {
  await SubmissionFailure.$match(classifySubmissionFailure(rejection), {
    NotIncluded: () => release(tx),
    Undetermined: () => Promise.resolve(),
  });
  throw rejection;
});
```

`NotIncluded` is about the send that was rejected. A node refuses a transaction a block already holds the same way it
refuses one it never saw, so before releasing after a retry, make sure no earlier send of the transaction may be in a
block. The facade releases only after the only send of a transaction: none other in flight, and none its lifecycle
record shows.

- `NotIncluded` - the rejection is a `SubmissionError` (bare, or inside the `FiberFailure` that `Effect.runPromise`
  rejects with) whose cause proves no block holds the transaction: the node usurped or invalidated it
  (`TransactionUsurpedError`, `TransactionInvalidError`), no connection was made (`ConnectionError`), the node's
  transaction pool refused it with a JSON-RPC error (polkadot-sdk author RPC codes 1001, 1002, 1010, 1011, 1014–1016,
  1018–1021), or the simulator discarded it (`LedgerError`).
- `Undetermined` - everything else: a dropped transaction (`TransactionDroppedError`), a finality timeout, pool codes
  1012 (temporarily banned) and 1013 (already imported), and any rejection that is not a submission service's own. A
  block may hold the transaction, so keep its bookings.
- `SubmissionFailure` is a `Data.taggedEnum`, so `SubmissionFailure.$is('NotIncluded')` works as a type guard too. The
  facade uses this to release a failed transaction's coins and Dust only on `NotIncluded`.

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

### Submission

- `classifySubmissionFailure` - Reads whether a rejected submission proves no block holds the transaction
- `SubmissionFailure` - Tagged enum `NotIncluded` | `Undetermined` returned by `classifySubmissionFailure`

## License

Apache-2.0
