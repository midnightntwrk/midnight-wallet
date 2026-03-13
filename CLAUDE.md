# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The Midnight Wallet SDK is a TypeScript implementation of the
[Midnight Wallet Specification](https://github.com/midnightntwrk/midnight-architecture/blob/main/components/WalletEngine/Specification.md).
It provides key generation, address formatting, transaction building, state syncing with the indexer, and testing
utilities for the Midnight privacy-focused blockchain.

## Key Specifications (ALWAYS CONSULT)

When working on wallet functionality, always consult these specifications:

### Wallet Specification

**Repository:** [midnight-architecture](https://github.com/midnightntwrk/midnight-architecture) **Path:**
`components/WalletEngine/Specification.md`

Key sections:

- Transaction lifecycle: pending → confirmed → finalized (or discarded)
- Coin lifecycle: booked → pending → confirmed → final
- Balance types: available, pending, total
- State operations: apply_transaction, finalize_transaction, discard_transaction, spend
- Synchronization process and indexing services

### DApp Connector API Specification

**Repository:** [midnight-dapp-connector-api](https://github.com/input-output-hk/midnight-dapp-connector-api) **NPM:**
[@midnight-ntwrk/dapp-connector-api](https://www.npmjs.com/package/@midnight-ntwrk/dapp-connector-api) **Path:**
`SPECIFICATION.md`

Key sections:

- API design philosophy and responsibilities
- Method signatures and expected behaviors
- Error handling requirements
- Transaction structure requirements

### DApp Connector API Types

**Path:** `src/api.ts` in the dapp-connector-api package

TypeScript type definitions for the connector API.

### Ledger Specification

**Repository:** [midnight-ledger](https://github.com/input-output-hk/midnight-ledger) **Path:** `spec/`

Key documents:

- `intents-transactions.md` - Transaction structure, intents, sections
- `zswap.md` - Shielded token protocol
- `dust.md` - Dust token mechanics
- `night.md` - Night/unshielded token mechanics
- `contracts.md` - Smart contract execution
- `cost-model.md` - Transaction fee calculation

### API Usage Examples

**Package:** `packages/docs-snippets`

Contains working code examples for common wallet operations:

- `combined-transfer.ts` - Transfer both shielded and unshielded tokens
- `shielded-transfer.ts` - Shielded token transfer
- `unshielded-transfer.ts` - Unshielded token transfer
- `swap.ts` - Token swap (intent creation)
- `balancing.ts` - Transaction balancing
- `initialization.ts` - Wallet initialization

**IMPORTANT:** Always refer to docs-snippets for API usage patterns when implementing new features.

## Build Commands

```bash
# Setup (use nvm or nix develop with direnv)
nvm use && corepack enable

# Install dependencies
yarn

# Build all packages
yarn dist

# Build specific package
yarn dist --filter=@midnight-ntwrk/wallet-sdk-facade

# Build and watch for changes
yarn watch

# Run all unit tests
yarn test

# Run tests for specific package
yarn test --filter=@midnight-ntwrk/wallet-sdk-unshielded-wallet

# Run specific test file
yarn test --filter=@midnight-ntwrk/wallet-sdk-unshielded-wallet -- test/UnshieldedWallet.test.ts

# Full CI verification (typecheck, lint, tests)
yarn verify

# Check/fix formatting
yarn format:check
yarn format

# Clean all build artifacts
yarn clean
```

## Architecture

### Three-Token Model

Midnight implements three token types, each requiring distinct wallet functionality:

1. **Unshielded Wallet** - Night and other unshielded tokens on the public ledger
2. **Shielded Wallet** - Custom shielded tokens with zero-knowledge proof support
3. **Dust Wallet** - Dust tokens for paying transaction fees

Each wallet type uses different addresses, credential proving methods, and state structures.

### Package Hierarchy

```
facade              ← Unified API combining all wallet types
   ├── shielded-wallet
   ├── unshielded-wallet
   └── dust-wallet
          ↓
runtime             ← Wallet lifecycle/variant orchestration for hard-forks
   ├── abstractions ← Interfaces that variants must implement
   └── capabilities ← Shared implementations (coin selection, tx balancing)
          ↓
utilities           ← Common types and operations
```

**External Communication:**

- `indexer-client` - GraphQL client for syncing state with midnight-indexer
- `node-client` - Polkadot RPC client for midnight-node
- `prover-client` - Client for zero-knowledge proof generation

**Key Management:**

- `hd` - HD-wallet API (BIP32/BIP39) for Midnight
- `address-format` - Bech32m formatting for keys and addresses

### Variant/Runtime Pattern

The SDK uses a variant-based architecture to support seamless wallet state migration during hard-forks:

```
WalletFacade → FacadeAPIAdapter → AWallet → WalletRuntime → RuntimeVariant(s)
```

- **RuntimeVariant**: Independent implementation for specific protocol versions
- **WalletRuntime**: Orchestrates variants and manages lifecycle
- **WalletBuilder**: Registers variants at build time

Each variant follows a Services + Capabilities pattern:

- **Service**: Async/side-effecting objects (sync streams, proving, submission)
- **Capability**: Pure functional state transformations (balances, coin selection)

### State Management

Uses Effect library with `SubscriptionRef` for BLoC-like state management:

- Immutable state that can only be modified through controlled methods
- Observable state stream for subscribers
- Atomic updates serialized through SubscriptionRef

## Key Dependencies

- **Effect** (`effect`) - Functional programming primitives, `SubscriptionRef` for state
- **RxJS** (`rxjs`) - Observable streams for reactive state
- **@midnight-ntwrk/ledger-v7** - Core ledger types and ZK proof types

## Testing

Tests use Vitest with workspace configuration. Each package has its own `vitest.config.ts`.

### Test-Driven Development (MANDATORY)

**THIS IS A HARD REQUIREMENT: Follow TDD strictly. Tests define the contract and cannot be weakened.**

**The TDD cycle:**

1. **Design the test thoroughly** before writing it:
   - Understand the exact behavior being tested
   - Consider what mocking infrastructure is needed
   - Ensure assertions are precise and verifiable
   - Design tests that can be implemented without modification

2. **Write the test** with precise assertions

3. **Verify the test fails** for the expected reason (red)

4. **User reviews and commits tests** before implementation begins

5. **Implement code** to make the test pass (green)

**CRITICAL: Once a test is written and confirmed failing, it MUST NOT be changed to accommodate:**
- Implementation difficulties
- Mocking infrastructure limitations
- API design issues
- Any other "practical" reasons

**If implementation cannot pass the test as written:**
1. Do NOT weaken the test assertions
2. Do NOT add comments like "mock can't do X, so we check Y instead"
3. Do NOT change precise assertions to loose ones (e.g., `toBe(5)` → `toBeGreaterThan(0)`)
4. Instead, gather ALL such failing cases
5. Present them to the user with:
   - What the test expects
   - What the implementation/mock currently provides
   - Why the gap exists
   - Proposed solutions (fix mock, change API design, etc.)
6. Wait for user decision before proceeding

**The test is the specification.** If the test seems wrong after implementation begins, that indicates a design problem that should have been caught in step 1. Go back to the user rather than silently weakening tests.

For tests requiring infrastructure (indexer-standalone), copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
# Generate APP_INFRA_SECRET: openssl rand -hex 32
```

## Versioning

Uses [Changesets](https://github.com/changesets/changesets) for version management:

```bash
# Add changeset for releasable changes
yarn changeset add

# Add empty changeset for non-release changes (docs, tooling)
yarn changeset add --empty

# Check for missing changesets
yarn changeset:check
```

## TypeScript Guidelines

### Purely Functional Style (MANDATORY)

**THIS IS A HARD REQUIREMENT: Write purely functional, side-effect-free code.**

All code in the Wallet SDK MUST be purely functional unless there is absolutely no alternative. This is not a preference - it is the default and expected style.

**NEVER use:**
- `let` declarations - use `const` only
- `for`/`while` loops - use `map`/`filter`/`reduce`/`flatMap`
- `array.push()`, `array.pop()`, `array.splice()` - these mutate
- `object[key] = value` mutations - build new objects instead
- `result` variables that get mutated in loops

**ALWAYS use:**
- `const` for all declarations
- `array.map()` to transform elements
- `array.filter()` to select elements
- `array.reduce()` to accumulate/aggregate values
- `array.flatMap()` to map and flatten
- `array.some()` / `array.every()` for boolean checks
- Spread syntax `{ ...obj, key: value }` to create modified copies
- `Array.from()` to convert iterables

**Examples of WRONG code (do not write this):**
```typescript
// WRONG: mutation with let and push
let total = 0n;
const result: string[] = [];
for (const item of items) {
  total += item.value;
  if (item.active) {
    result.push(item.name);
  }
}

// WRONG: object mutation
const obj: Record<string, bigint> = {};
for (const item of items) {
  obj[item.key] = (obj[item.key] ?? 0n) + item.value;
}
```

**Examples of CORRECT code:**
```typescript
// CORRECT: pure functional
const total = items.reduce((sum, item) => sum + item.value, 0n);
const result = items.filter((item) => item.active).map((item) => item.name);

// CORRECT: reduce to build object
const obj = items.reduce(
  (acc, item) => ({ ...acc, [item.key]: (acc[item.key] ?? 0n) + item.value }),
  {} as Record<string, bigint>,
);

// CORRECT: conditional object properties
return {
  ...(shielded !== undefined ? { shielded } : {}),
  ...(unshielded !== undefined ? { unshielded } : {}),
};
```

**The only exceptions** where mutation may be acceptable:
- Performance-critical inner loops with measured bottlenecks (rare)
- Interacting with inherently mutable external APIs
- Test setup/teardown code

Even in these cases, isolate mutations and document why they are necessary.

### Type Casts

**Avoid type casts (`as Type`) whenever possible.** Type casts bypass TypeScript's type checking and can hide bugs.

Before using a type cast, exhaust all other options:
1. Fix the underlying type definitions
2. Use type guards or narrowing
3. Use generics properly
4. Refactor code to improve type inference

If a type cast is absolutely necessary after exhausting other options, it **must** include a justification comment explaining why:

```typescript
// Type cast required because: <specific reason why no alternative exists>
const value = someValue as SomeType;
```

## Transaction Inspection

When working with transactions (especially in tests), use the ledger types from `@midnight-ntwrk/ledger-v7`.

### Key References

**Ledger TypeScript Types:**
- `node_modules/@midnight-ntwrk/ledger-v7/ledger-v7.d.ts` - Full type definitions for Transaction, Intent, ZswapOffer, DustActions, etc.

**Ledger Specification (midnight-ledger repo):**
- `spec/intents-transactions.md` - Transaction structure, intents, segments, binding
- `spec/zswap.md` - Shielded token protocol, ZswapOffer structure
- `spec/dust.md` - Dust token mechanics and fee payment
- `spec/night.md` - Unshielded token mechanics

**Wallet SDK Examples:**
- `packages/unshielded-wallet/src/v1/Transacting.ts` - Transaction building patterns
- `packages/unshielded-wallet/src/v1/test/transacting.test.ts` - Transaction test examples
- `packages/docs-snippets/` - API usage examples for transfers, swaps, balancing

**DApp Connector Reference Tests:**
- `packages/dapp-connector-reference/src/test/transfer.test.ts` - Transaction inspection helpers (deserialize, check balance, count outputs, verify DustSpend)
- `packages/dapp-connector-reference/src/test/intent.test.ts` - Intent imbalance verification helpers

### Key Concepts

- **Transaction type parameters**: `Transaction<Signaturish, Proofish, Bindingish>` - controls signature/proof/binding state
- **FinalizedTransaction**: `Transaction<SignatureEnabled, Proof, Binding>` - ready for submission
- **Segments**: 0 = guaranteed (executes first), 1-65535 = fallible (can fail independently)
- **Imbalances**: `tx.imbalances(segmentId)` returns `Map<TokenType, bigint>` - zero means balanced
- **DustSpend**: Fee payment actions in `intent.dustActions.spends`

## Web Packaging Note

Browser builds require polyfills for Node's `Buffer` and `assert`.
