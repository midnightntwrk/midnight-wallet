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

## Build Commands and tools in use

All commands must be run from the repository root. Do not cd into a package directory to run commands — shared
devDependencies (vitest, typescript, eslint, etc.) are hoisted to the root node_modules and won't resolve from
individual package directories. Use --filter to target specific packages.

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

# Add a changeset for versioning
yarn changeset add

# Check for missing changesets
yarn changeset:check

# --- Effect Language Service (see section below) ---
# Run Effect diagnostics on a specific file
yarn effect-language-service diagnostics --file "$(pwd)/path/to/file.ts" --format pretty

# Run Effect diagnostics on a whole package (must use tsconfig.build.json or tsconfig.test.json, NOT tsconfig.json — the latter uses references with no source files)
yarn effect-language-service diagnostics --project "$(pwd)/packages/dust-wallet/tsconfig.build.json" --format pretty

# Show quickfixes (report-only, does not auto-apply) on a specific file
yarn effect-language-service quickfixes --file "$(pwd)/path/to/file.ts"

```

### Effect Language Service

The project uses `@effect/language-service` for Effect-specific diagnostics, quickfixes, and code quality checks. It is
configured in `tsconfig.base.json` as a TypeScript plugin.

**CLI commands** (all prefixed with `yarn effect-language-service`):

- `diagnostics` — Report Effect-specific issues (floating effects, wrong yield usage, deterministic keys, etc.)
- `quickfixes` — Show diagnostics with proposed code diffs (report-only, does NOT auto-apply fixes)
- `codegen` — Apply `@effect-codegens` directive transformations (this one DOES write changes)
- `overview` — Summarize Effect exports (services, layers, errors) in a file or project
- `layerinfo` — Show layer dependency info and composition suggestions

**Targeting scope:** Use `--file path` for a single file or `--project tsconfig.json` for a whole package. Always use
absolute paths (prefix with `$(pwd)/`). Important: `--project` must point to a tsconfig that includes source files
directly (e.g., `tsconfig.build.json` or `tsconfig.test.json`), not one that only has `references` — the root
`tsconfig.json` and package-level `tsconfig.json` files won't work.

**Project-enforced rules** (configured in `tsconfig.base.json`):

- `deterministicKeys: "error"` — `Data.TaggedError` and service keys must follow the deterministic naming pattern based
  on the file path
- `importAliases: "error"` — Effect modules that shadow globals must use the configured aliases: `Array→EArray`,
  `Record→ERecord`, `Number→ENumber`, `String→EString`, `Boolean→EBoolean`, `Function→EFunction`

**After modifying Effect code**, run diagnostics on changed files to catch issues early:

```bash
git diff --name-only --diff-filter=ACMR HEAD -- '*.ts' | xargs -I{} yarn effect-language-service diagnostics --file "$(pwd)/{}" --format pretty
```

## Architecture

For detailed architecture documentation with diagrams, see:

- **`docs/Design.md`** - Comprehensive design document covering variant structure, state management, and code examples
- **`docs/decisions/`** - Architecture Decision Records (ADRs)

Key ADRs:

- ADR 0001 - BLoC pattern for state management
- ADR 0004 - Use of Effect library
- ADR 0006 - Variant/Builder/Facade architecture

### Three-Token Model

Midnight implements three token types/resources, each requiring distinct wallet functionality:

1. **Unshielded Wallet** - Night and other unshielded tokens on the public ledger
2. **Shielded Wallet** - Custom shielded tokens with zero-knowledge proof support
3. **Dust Wallet** - Dust for paying transaction fees. Under no circumstances refer to Dust as a "token". It's a
   resource generated from Night tokens, which sole purpose is fee payments

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

Capabilities operate on state synchronously; services provide data that capabilities process.

### State Management

Uses Effect library with `SubscriptionRef` for BLoC-like state management:

- Immutable state that can only be modified through controlled methods
- Observable state stream for subscribers
- Atomic updates serialized through SubscriptionRef

## Key Dependencies

- **Effect** (`effect`) - Functional programming primitives, `SubscriptionRef` for state
  - Use namespace imports for Effect types that conflict with globals:
    `import { Array as EArray, Record as ERecord } from 'effect';`
  - Typed error handling via `Either` and `Effect.fail` (Either in pure/synchronous context, `Effect.fail` and friends
    in side-effectful one)
  - The project uses @effect/language-service for Effect-specific diagnostics, quickfixes, and code quality checks. It
    is configured in tsconfig.base.json as a TypeScript plugin.
- **RxJS** (`rxjs`) - Observable streams for reactive state
  - Only in APIs exposed to the users of the SDK
- **@midnight-ntwrk/ledger-v8** - Core ledger types and ZK proof types

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
   - Avoid usage of mocks in sense `vi.fn` or `vi.mock`; if possible implement an stub object/function providing
     expected data instead and/or use fakes (a good related articles on the topic are
     https://blog.ploeh.dk/2022/10/17/stubs-and-mocks-break-encapsulation/ and
     https://martinfowler.com/articles/mocksArentStubs.html#DrivingTdd)

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

**The test is the specification.** If the test seems wrong after implementation begins, that indicates a design problem
that should have been caught in step 1. Go back to the user rather than silently weakening tests.

For tests requiring infrastructure (indexer-standalone), copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
# Generate APP_INFRA_SECRET: openssl rand -hex 32
```

### Testing Effect Code

Use `Effect.runPromise` or `Effect.runSync` to unwrap Effects in tests:

```typescript
it('should fetch user', async () => {
  const result = await Effect.runPromise(fetchUser('123'));
  expect(result.name).toBe('Alice');
});
```

For testing failures, use `Exit`:

```typescript
import { Exit } from 'effect';

it('should fail for invalid id', async () => {
  const exit = await Effect.runPromiseExit(fetchUser('invalid'));
  expect(Exit.isFailure(exit)).toBe(true);
});
```

Mock services using Layer:

```typescript
const MockUserService = Layer.succeed(UserService, {
  fetch: () => Effect.succeed(mockUser),
});

it('should use mock', async () => {
  const result = await pipe(fetchUser('123'), Effect.provide(MockUserService), Effect.runPromise);
  expect(result).toEqual(mockUser);
});
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

## Functional Programming Principles

This codebase follows functional programming principles rigorously. These patterns are **mandatory** - not preferences.

### Functional Core, Imperative Shell (Impureim Sandwich)

Structure code in three layers:

1. **Impure (input)**: Read data from external sources (indexer sync, user input, RPC)
2. **Pure (transform)**: Process data with pure functions - all business logic lives here
3. **Impure (output)**: Write results to external targets (submit tx, update state ref, emit events)

The "sandwich" keeps all business logic pure and testable, with side effects only at the edges.

**Codebase pattern:**

```typescript
// Capability (pure core) - transforms state, returns Either
balanceTransaction(state, tx): Either.Either<[BalancingResult, State], WalletError>

// Service (imperative shell) - orchestrates I/O around pure core
sync(): Stream.Stream<Update> → Capability.apply(state, update) → SubscriptionRef.update(ref, newState)
```

**Canonical examples:**

- `packages/unshielded-wallet/src/v1/UnshieldedState.ts` - Pure state transformations
- `packages/capabilities/src/pendingTransactions/pendingTransactionsService.ts` - Service orchestrating pure updates

### Parse, Don't Validate

Instead of `validate(input): boolean`, use `parse(input): ValidType | Error`.

The parsed type makes invalid states **unrepresentable** through the type system.

```typescript
// WRONG: validate returns boolean, caller can ignore result or use raw input
const isValid = validateAddress(input);
if (isValid) {
  /* input is still untyped string */
}

// RIGHT: parse returns typed value - invalid inputs cannot proceed
const address: ShieldedAddress = parseShieldedAddress(input, networkId, field);
// address is now a validated ShieldedAddress, not a string
```

**Use branded types** to prevent mixing similar primitives:

```typescript
// packages/abstractions/src/ProtocolVersion.ts
type ProtocolVersion = Brand.Branded<bigint, 'ProtocolVersion'>;
const ProtocolVersion = Brand.nominal<ProtocolVersion>();
```

**Canonical examples:**

- `packages/dapp-connector-reference/src/parsing.ts` - `parseTokenType`, `parseShieldedAddress`
- `packages/abstractions/src/ProtocolVersion.ts` - Branded type with `Brand.nominal`
- `packages/address-format/src/index.ts` - Bech32m parsing returns typed addresses

### Make Illegal States Unrepresentable

Design types so invalid states **cannot be constructed**:

**Use branded types** to distinguish semantically different values:

```typescript
// WRONG: Both are just strings, easily confused
function transfer(from: string, to: string, amount: bigint): void;

// RIGHT: Types prevent confusion at compile time
type ShieldedAddress = Brand.Branded<Uint8Array, 'ShieldedAddress'>;
type UnshieldedAddress = Brand.Branded<Uint8Array, 'UnshieldedAddress'>;
function transfer(from: ShieldedAddress, to: ShieldedAddress, amount: bigint): void;
```

**Use tagged unions** to model mutually exclusive states:

```typescript
// WRONG: Both fields optional, unclear valid combinations
type Result = { data?: Data; error?: Error };

// RIGHT: Exactly one state is valid
type Result = { _tag: 'Success'; data: Data } | { _tag: 'Failure'; error: Error };
```

### Total Functions

Functions should be **total** - defined for all inputs of their declared type:

```typescript
// PARTIAL (avoid): Throws for empty array - undefined behavior
const head = <T>(arr: T[]): T => arr[0]; // undefined if empty!

// TOTAL (prefer): Returns Option - handles all inputs
const head = <T>(arr: T[]): Option<T> => (arr.length > 0 ? Option.some(arr[0]) : Option.none());

// TOTAL (alternative): Restrict input type
const head = <T>(arr: NonEmptyReadonlyArray<T>): T => arr[0];
```

**Rules:**

- Never throw for expected error conditions
- Use `Option` for values that may not exist
- Use `Either`/`Effect` for operations that may fail
- Restrict input types when possible (`NonEmptyArray`, branded types)

### Immutability and Pure Functions (MANDATORY)

**THIS IS A HARD REQUIREMENT: Write purely functional, side-effect-free code.**

All code in the Wallet SDK MUST be purely functional unless there is absolutely no alternative. This is not a
preference - it is the default and expected style.

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

If a type cast is absolutely necessary after exhausting other options, it **must** include a justification comment
explaining why:

```typescript
// Type cast required because: <specific reason why no alternative exists>
const value = someValue as SomeType;
```

### Separation of Effect and Either

**Critical distinction - these are NOT interchangeable:**

- **Either** = pure synchronous computation, no side effects, for validation and state transformations
- **Effect** = description of side-effecting computation (async, resources, errors, DI)

**When to use which:** | Use Case | Type | Example | |----------|------|---------| | Pure validation | `Either` |
`parseAddress(input): Either<Address, ParseError>` | | State transformation | `Either` |
`applyUpdate(state, update): Either<State, Error>` | | Business logic | `Either` |
`balanceTransaction(state, tx): Either<Result, Error>` | | I/O operations | `Effect` |
`fetchFromIndexer(): Effect<Data, NetworkError>` | | Resource management | `Effect` |
`withConnection(f): Effect<R, Error>` | | Async operations | `Effect` | `prove(tx): Effect<ProvenTx, ProvingError>` | |
Dependency injection | `Effect` | Using `Context.Tag` for services |

**Never mix them carelessly:**

```typescript
// WRONG: Either inside Effect for pure logic
Effect.gen(function* () {
  const result = yield* Effect.succeed(Either.right(compute(x))); // Unnecessary wrapping
});

// RIGHT: Either for pure, Effect only at boundary
const pureResult = computePurely(input); // Returns Either
return EitherOps.toEffect(pureResult); // Convert at boundary only
```

**Canonical examples:**

- `packages/utilities/src/EitherOps.ts` - Either utilities including `toEffect` conversion
- `packages/shielded-wallet/src/v1/Transacting.ts` - Capabilities return Either
- `packages/capabilities/src/proving/provingService.ts` - Services use Effect

### Generator vs Pipe Style

Both `Effect.gen` and `pipe` are valid but serve different purposes:

**Use `Effect.gen`** (do-notation style) when:

- Multiple sequential operations need intermediate values
- Complex control flow with conditions
- Readability benefits from imperative-looking code

```typescript
Effect.gen(function* () {
  const user = yield* fetchUser(id);
  const profile = yield* fetchProfile(user.profileId);
  if (profile.isAdmin) {
    yield* logAdminAccess(user);
  }
  return { user, profile };
});
```

**Use `pipe`** when:

- Simple linear transformations
- Single operation chains
- Parallel operations (`Effect.all`, `apS` pattern)

```typescript
pipe(
  fetchUser(id),
  Effect.flatMap((user) => fetchProfile(user.profileId)),
  Effect.map((profile) => ({ profile })),
);
```

**Avoid mixing** both styles in the same function - pick one for consistency, but prefer pipes if custom operators need
to be used. Never use `.gen` variant for a single operation.

The above also is valid for usage with other Effect types, like `Either`

### State Management with Refs

State lives in **refs**, pure functions **transform** it, services **orchestrate** updates.

**SubscriptionRef** - BLoC-like immutable state with observable changes:

```typescript
// State container
#state: SubscriptionRef.SubscriptionRef<PendingTransactions>;

// Initialize
this.#state = SubscriptionRef.make<Type>(initialState).pipe(Effect.runSync);

// Update with pure function
SubscriptionRef.update(this.#state, (state) =>
  PendingTransactions.addPendingTransaction(state, tx, now, this.#txTrait)
);

// Observable stream of changes
state(): Stream.Stream<T> {
  return Stream.concat(
    Stream.fromEffect(SubscriptionRef.get(this.#state)),
    this.#state.changes
  );
}
```

**SynchronizedRef** - Thread-safe mutable reference for variant state in Runtime.

**Pattern:** Pure capabilities return new state, services update refs:

```typescript
// Pure capability (no ref access)
const newState = Capability.applyUpdate(oldState, update);

// Service updates ref
yield * SubscriptionRef.update(this.#state, () => newState);
```

Do not ever mix `Ref.get` or `SubscriptionRef.get` (or similar) with methods changing the state. Always ensure to use
`Ref.update`, `Ref.modify` or similar to change the state and always use the only state reference the one provided in
the callback. Otherwise, it is easy to cause unwanted concurrency issues usage of `Ref` and its variants is meant to
prevent.

### Resource Management

Use Effect's resource management for anything that needs cleanup:

**Scoped resources** with automatic cleanup:

```typescript
const withConnection = Effect.scoped(
  Effect.acquireRelease(
    openConnection(), // acquire
    (conn) => closeConnection(conn), // release (always runs)
  ),
);
```

**In services** - use Scope for lifecycle management:

```typescript
Effect.gen(function* () {
  const scope = yield* Effect.scope;
  yield* Scope.addFinalizer(scope, () => cleanup());
  // Resource is cleaned up when scope closes
});
```

### Concurrency Patterns

**Sequential** (default with flatMap/gen):

```typescript
Effect.gen(function* () {
  const a = yield* fetchA(); // waits
  const b = yield* fetchB(); // waits for a to complete
  return [a, b];
});
```

**Parallel** - use when operations are independent:

```typescript
// Both run concurrently
Effect.all([fetchA(), fetchB()], { concurrency: 'unbounded' });

// Or with Do notation for named results
pipe(
  Effect.Do,
  Effect.bind('a', () => fetchA()), // starts immediately
  Effect.bind('b', () => fetchB()), // starts immediately (parallel)
);
```

**Rule**: Use parallel execution when operations don't depend on each other's results.

### Typeclass-like Patterns

TypeScript lacks typeclasses, but the codebase simulates them via explicit dictionary passing.

**Trait Pattern** - Define operations over a generic type, pass instance explicitly:

```typescript
// packages/capabilities/src/pendingTransactions/pendingTransactions.ts
export type TransactionTrait<TTransaction> = {
  ids: (tx: TTransaction) => readonly string[];
  firstId: (tx: TTransaction) => string;
  areAllTxIdsIncluded: (tx: TTransaction, txIds: readonly string[]) => boolean;
  hasTTLExpired: (tx: TTransaction, txCreationTime: DateTime.Utc, now: DateTime.Utc) => boolean;
  serialize: (tx: TTransaction) => Uint8Array;
  deserialize: (serialized: Uint8Array) => TTransaction;
};

// Functions take trait as explicit parameter (dictionary passing)
export const has = <TTransaction>(
  transactions: PendingTransactions<TTransaction>,
  transaction: TTransaction,
  txTrait: TransactionTrait<TTransaction>,  // <-- typeclass instance
): boolean => {
  return transactions.all.some((item) =>
    txTrait.areAllTxIdsIncluded(transaction, txTrait.ids(item.tx))
  );
};

export const addPendingTransaction = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  tx: TTransaction,
  now: DateTime.Utc,
  txTrait: TransactionTrait<TTransaction>,  // <-- same pattern
): PendingTransactions<TTransaction> => { ... };
```

This pattern allows generic functions to work with any type that has a matching trait implementation.

**Monoid Pattern** - Algebraic typeclass for composable operations:

```typescript
// packages/utilities/src/ArrayOps.ts
type Monoid<T> = { empty: T; combine: (a: T, b: T) => T };

const bigintAdditionMonoid: Monoid<bigint> = {
  empty: 0n,
  combine: (a, b) => a + b,
};

// Generic function using monoid
const total = generalSum(
  items.map((i) => i.value),
  bigintAdditionMonoid,
);
```

**PolyFunction Dispatch** - Type-safe polymorphism over tagged variants (for ADT handling):

```typescript
// packages/utilities/src/polyFunction.ts
type PolyFunction<Variants, T> = { [V in Variants as TagOf<V>]: (variant: V) => T };

// Usage - exhaustive, type-safe dispatch
dispatch(stateChange, {
  State: (s) => handleState(s.state),
  ProgressUpdate: (p) => handleProgress(p.sourceGap, p.applyGap),
  VersionChange: (v) => handleVersionChange(v.change),
});
```

**Dual Functions** - Support both curried and uncurried calling:

```typescript
// packages/utilities/src/ArrayOps.ts
export const fold: {
  <T>(folder: (acc: T, item: T) => T): (arr: NonEmptyReadonlyArray<T>) => T;
  <T>(arr: NonEmptyReadonlyArray<T>, folder: (acc: T, item: T) => T): T;
} = dual(2, (arr, folder) => arr.reduce(folder));

// Both work:
fold(arr, (a, b) => a + b); // Direct call
arr.pipe(fold((a, b) => a + b)); // Piped
```

### Algebraic Data Types (ADTs)

**Tagged Enums** - Sealed hierarchies like Scala sealed traits / F# discriminated unions:

```typescript
// packages/runtime/src/abstractions/StateChange.ts
type StateChange<TState> = Data.TaggedEnum<{
  State: { readonly state: TState };
  ProgressUpdate: { readonly sourceGap: bigint; readonly applyGap: bigint };
  VersionChange: { readonly change: VersionChangeType };
}>;

const { $match: match, $is: is, State, ProgressUpdate, VersionChange } = Data.taggedEnum<StateChange<S>>();

// Exhaustive pattern matching
match(change, {
  State: (s) => ...,
  ProgressUpdate: (p) => ...,
  VersionChange: (v) => ...,
});

// Type predicates
if (is('State')(change)) { /* change.state is available */ }
```

**Tagged Errors** - Typed errors like Scala case classes:

```typescript
// packages/node-client/src/effect/NodeClientError.ts
export class SubmissionError extends Data.TaggedError('SubmissionError')<{
  message: string;
  txData: SerializedTransaction;
  cause?: unknown;
}> {}

// Union of error types for exhaustive handling
type WalletError = InsufficientFundsError | AddressError | SyncError | ...;
```

### Error Modeling

**Create specific error types** for each failure mode:

```typescript
class UserNotFoundError extends Data.TaggedError('UserNotFound')<{
  userId: string;
}> {}

class NetworkError extends Data.TaggedError('NetworkError')<{
  url: string;
  cause: unknown;
}> {}

// Union type enables exhaustive handling
type FetchError = UserNotFoundError | NetworkError;

// Pattern match on errors
Effect.catchAll(effect, (error) =>
  match(error, {
    UserNotFound: (e) => handleNotFound(e.userId),
    NetworkError: (e) => handleNetwork(e.url),
  }),
);
```

**Error channel composition** - errors accumulate through the type system:

```typescript
declare const fetchUser: Effect.Effect<User, NetworkError>;
declare const validateUser: (u: User) => Either<ValidUser, ValidationError>;

// Result type: Effect<ValidUser, NetworkError | ValidationError>
const result = pipe(
  fetchUser,
  Effect.flatMap((user) => EitherOps.toEffect(validateUser(user))),
);
```

### Scala/F# Idiom Translation

| Scala/F# Idiom    | TypeScript Equivalent                           | Example Location                                                       |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| for-comprehension | `Effect.gen(function* () { ... })`              | `packages/runtime/src/Runtime.ts`                                      |
| case class        | `Data.TaggedError`, `Data.Class`                | `packages/node-client/src/effect/NodeClientError.ts`                   |
| sealed trait / DU | `Data.taggedEnum`                               | `packages/runtime/src/abstractions/StateChange.ts`                     |
| implicit / given  | `Context.Tag` + service resolution              | `packages/node-client/src/effect/NodeClient.ts`                        |
| `\|>` pipe        | `pipe()` from effect                            | Throughout                                                             |
| Railway-oriented  | `Either.map`, `Either.flatMap` chains           | `packages/utilities/src/EitherOps.ts`                                  |
| Pattern matching  | `match({ onLeft, onRight })`, `$match`          | Throughout                                                             |
| typeclass         | Trait interface + explicit passing, `Monoid<T>` | `packages/capabilities/src/pendingTransactions/pendingTransactions.ts` |

### Anti-Patterns (NEVER DO)

| Anti-Pattern                               | Correct Alternative              |
| ------------------------------------------ | -------------------------------- |
| `Promise` directly in internal code        | Wrap in `Effect.tryPromise`      |
| Throw exceptions for expected errors       | Return `Either` or `Effect.fail` |
| Use `null`/`undefined` for optional values | Use `Option`                     |
| Classes with mutable internal state        | Refs + pure functions            |
| Mix Effect and raw async/await             | Keep Effect composition pure     |
| Validate and return boolean                | Parse and return typed value     |
| `let` + mutation in loops                  | `reduce`, `map`, `filter`        |

**Exception**: Facades (per ADR 0006) expose Promise/RxJS APIs - that's intentional boundary translation, not internal
code.

### Effect Usage Boundaries

Per [ADR 0006](docs/decisions/0006-structure-for-flexibility-and-robustness.md):

- **Internal code**: Use Effect for composition, error handling, resources
- **Facade APIs**: Expose Promise/RxJS - do NOT require Effect knowledge from users
- **Integration points**: Effect-based internally, translated at facade boundary

**Effect is a rich library** - many problems are already solved. Before writing custom utilities, check if Effect
provides a solution:

| Module                             | Provides                                   |
| ---------------------------------- | ------------------------------------------ |
| `effect/Array`                     | `NonEmptyReadonlyArray`, `reduce`, `match` |
| `effect/Function`                  | `dual`, `pipe`, `identity`, `constVoid`    |
| `effect/Brand`                     | Branded types for type safety              |
| `effect/Data`                      | `TaggedEnum`, `TaggedError`, `Class`       |
| `effect/Match`                     | Pattern matching combinators               |
| `effect/HashMap`, `effect/HashSet` | Immutable collections                      |
| `effect/Option`, `effect/Either`   | Sum types                                  |
| `effect/Schema`                    | Validation and parsing                     |

**Remember: patterns are transferable, APIs are not.** A developer working on facades may not use Effect directly, but
should still follow the same functional principles.

### Canonical Pattern Files

When implementing new features, refer to these exemplary files:

| Pattern                              | File                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Trait/typeclass (dictionary passing) | `packages/capabilities/src/pendingTransactions/pendingTransactions.ts`        |
| PolyFunction dispatch (ADT handling) | `packages/utilities/src/polyFunction.ts`                                      |
| Either utilities                     | `packages/utilities/src/EitherOps.ts`                                         |
| Monoid, dual functions               | `packages/utilities/src/ArrayOps.ts`                                          |
| Tagged enum ADT                      | `packages/runtime/src/abstractions/StateChange.ts`                            |
| Service/Capability separation        | `packages/capabilities/src/pendingTransactions/pendingTransactionsService.ts` |
| Pure state transformations           | `packages/unshielded-wallet/src/v1/UnshieldedState.ts`                        |
| Parse don't validate                 | `packages/dapp-connector-reference/src/parsing.ts`                            |
| Branded types                        | `packages/abstractions/src/ProtocolVersion.ts`                                |

## Transaction Inspection

When working with transactions (especially in tests), use the ledger types from `@midnight-ntwrk/ledger-v7`.

### Key References

**Ledger TypeScript Types:**

- `node_modules/@midnight-ntwrk/ledger-v7/ledger-v7.d.ts` - Full type definitions for Transaction, Intent, ZswapOffer,
  DustActions, etc.

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

- `packages/dapp-connector-reference/src/test/transfer.test.ts` - Transaction inspection helpers (deserialize, check
  balance, count outputs, verify DustSpend)
- `packages/dapp-connector-reference/src/test/intent.test.ts` - Intent imbalance verification helpers

### Key Concepts

- **Transaction type parameters**: `Transaction<Signaturish, Proofish, Bindingish>` - controls signature/proof/binding
  state
- **FinalizedTransaction**: `Transaction<SignatureEnabled, Proof, Binding>` - ready for submission
- **Segments**: 0 = guaranteed (executes first), 1-65535 = fallible (can fail independently)
- **Imbalances**: `tx.imbalances(segmentId)` returns `Map<TokenType, bigint>` - zero means balanced
- **DustSpend**: Fee payment actions in `intent.dustActions.spends`

## Documentation Standards

Public APIs should include JSDoc comments with:

````typescript
/**
 * Parses a Bech32m string into a ShieldedAddress.
 *
 * @param address - The Bech32m encoded address string
 * @param networkId - Network identifier for validation
 * @param fieldName - Field name for error messages
 * @returns Validated ShieldedAddress
 * @throws APIError.invalidRequest if the address is invalid
 *
 * @example
 * ```typescript
 * const addr = parseShieldedAddress(
 *   "mn_shield-addr1...",
 *   "mainnet",
 *   "recipient"
 * );
 * ```
 */
export const parseShieldedAddress = (...) => { ... };
````

**Required for public APIs:**

- Clear description of purpose
- `@param` for each parameter
- `@returns` describing return value
- `@throws` for functions that can throw (facade APIs)
- `@example` with working code snippet

## Web Packaging Note

Browser builds require polyfills for Node's `Buffer` and `assert`.

## Common Gotchas

- **ESM + project references = `yarn dist` required.** Each package's `tsconfig.build.json` points imports at sibling
  packages' `dist/` directories. If you change a package's source, downstream packages won't see the updated types or
  code until `yarn dist` is run. Forgetting this leads to confusing "module not found" or stale-type errors.
- **Turbo handles this for `test`, `typecheck`, and `lint`.** These tasks declare `dependsOn: ["^dist"]` in
  `turbo.json`, so running `yarn test` (or `yarn test --filter=...`) automatically builds upstream dependencies first.
  You do NOT need to manually run `yarn dist` before `yarn test`.
- **But Turbo caching can bite you.** If Turbo thinks nothing changed (cache hit), it won't rebuild. After switching
  branches, rebasing, or making changes Turbo doesn't track, use `--force` to bypass the cache: `yarn dist --force`,
  `yarn test --force`.
