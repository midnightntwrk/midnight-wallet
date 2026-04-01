# Skills for midnight-wallet

Custom slash commands for common development tasks.

## /pre-push

**IMPORTANT: Run this before pushing to ensure CI will pass.**

Runs format check and basic verification to catch issues before they hit CI.

**Usage:**

- `/pre-push` - Run pre-push checks

**Implementation:**

```bash
yarn format:check && yarn check
```

This catches:

- Formatting issues (Prettier)
- TypeScript compilation errors
- Basic lint issues

For full CI verification (including tests), use `/verify`.

## /test

Run tests for a specific package or all packages.

**Usage:**

- `/test` - Run all tests
- `/test unshielded-wallet` - Run tests for specific package
- `/test unshielded-wallet UnshieldedWallet.test.ts` - Run specific test file

**Implementation:**

```bash
# All tests
yarn test

# Specific package
yarn test --filter=@midnight-ntwrk/wallet-sdk-{package}

# Specific file
yarn test --filter=@midnight-ntwrk/wallet-sdk-{package} -- test/{file}
```

## /build

Build packages.

**Usage:**

- `/build` - Build all packages
- `/build facade` - Build specific package

**Implementation:**

```bash
yarn dist
# or
yarn dist --filter=@midnight-ntwrk/wallet-sdk-{package}
```

## /verify

Run full CI verification (typecheck, lint, tests). Use this before creating PRs.

**Usage:**

- `/verify` - Run complete verification (equivalent to CI pipeline)

**Implementation:**

```bash
yarn verify
```

This runs:

- `yarn check` - TypeScript compilation
- `yarn lint` - ESLint
- `yarn test` - All unit tests
- `yarn format:check` - Prettier formatting

**Note:** This can take several minutes. For quick checks before pushing, use `/pre-push` instead.

## /changeset

Create a changeset for version management.

**Usage:**

- `/changeset` - Interactive changeset creation
- `/changeset --empty` - Empty changeset for non-release changes

**Implementation:**

```bash
yarn changeset add
# or
yarn changeset add --empty
```

## /format

Check or fix code formatting.

**Usage:**

- `/format` - Fix formatting
- `/format --check` - Check only

**Implementation:**

```bash
yarn format
# or
yarn format:check
```

## /new-capability

Scaffold a new capability following the Service/Capability pattern.

**Usage:**

- `/new-capability BalanceCalculation` - Create new capability

**Template structure:**

```
packages/capabilities/src/{name}/
├── {name}.ts           # Pure capability interface and functions
├── {name}Service.ts    # Service wrapper with Effect
└── test/
    └── {name}.test.ts  # Unit tests
```

**Capability interface pattern:**

```typescript
export interface {Name}Capability<TState> {
  operation(state: TState, input: Input): Either.Either<TState, {Name}Error>;
}
```

## /new-error

Create a new tagged error type.

**Usage:**

- `/new-error InsufficientBalance` - Create error in current package

**Template:**

```typescript
export class {Name}Error extends Data.TaggedError('{Name}')<{
  message: string;
  // Add specific fields
}> {}
```

## /inspect-state

Helper for debugging wallet state in tests.

**Usage:**

- `/inspect-state walletState` - Generate inspection code for state variable

**Generates:**

```typescript
console.log('Available UTXOs:', HashMap.size(state.availableUtxos));
console.log('Pending UTXOs:', HashMap.size(state.pendingUtxos));
// ... relevant state inspection
```

## /check-fp

Verify code follows functional programming patterns.

**Usage:**

- `/check-fp src/MyFile.ts` - Check specific file

**Checks for:**

- `let` declarations (should use `const`)
- `for`/`while` loops (should use map/filter/reduce)
- Array mutations (`push`, `pop`, `splice`)
- Object mutations
- Thrown exceptions (should use Either/Effect)
- Raw `null`/`undefined` (should use Option)

## Claude Code Hooks

The repository includes `.claude/settings.json` with hooks that run automatically:

**PostToolUse hook** - After file edits (Edit/Write tools), runs format check:

```
yarn format:check:root
```

If formatting fails, you'll see a message prompting you to run `yarn format`.

This catches formatting issues early, before they cause CI failures.
