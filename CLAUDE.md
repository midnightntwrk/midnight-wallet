# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Midnight Wallet SDK - TypeScript implementation of the Midnight Wallet Specification. A Yarn workspaces monorepo with
Turborepo for building wallet functionality including key generation, transaction building, shielded token operations
with zero-knowledge proofs, and blockchain synchronization.

## Commands

**All commands must be run from the repository root.** Do not `cd` into a package directory to run commands — shared
devDependencies (vitest, typescript, eslint, etc.) are hoisted to the root `node_modules` and won't resolve from
individual package directories. Use `--filter` to target specific packages.

```bash
# Install dependencies
yarn

# Build all packages (Turborepo caches results; use --force to bypass cache)
yarn dist
# yarn dist --force

# Build specific package
yarn dist --filter=@midnight-ntwrk/wallet-sdk-facade

# Build and watch for changes
yarn watch

# Run all tests
yarn test

# Run tests for specific package
yarn test --filter=@midnight-ntwrk/wallet-sdk-unshielded-wallet

# Run specific test file
yarn test --filter=@midnight-ntwrk/wallet-sdk-unshielded-wallet -- test/UnshieldedWallet.test.ts

# Full CI verification (typecheck, lint, test)
yarn verify

# Format code
yarn format

# Lint
yarn lint

# Clean dist directories
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

# Run Effect diagnostics on only git-changed .ts files
git diff --name-only --diff-filter=ACMR HEAD -- '*.ts' | xargs -I{} yarn effect-language-service diagnostics --file "$(pwd)/{}" --format pretty
```

## Architecture

### Token Types and Wallet Components

Midnight has 3 token types requiring separate wallet implementations:

- **Unshielded tokens** (Night and others) - `unshielded-wallet`
- **Dust** (transaction fees) - `dust-wallet`
- **Shielded tokens** (zero-knowledge proof based) - `shielded-wallet`

The `facade` package unifies these into a single API.

### Package Dependency Hierarchy

```
facade (unified API)
  ├── shielded-wallet, unshielded-wallet, dust-wallet
  │     └── runtime (variant lifecycle management)
  │           └── abstractions (interfaces for variants)
  ├── capabilities (shared: coin selection, tx balancing)
  └── address-format, hd, utilities

External clients: indexer-client, node-client, prover-client
```

### Variant Architecture

Each wallet type uses a variant-based architecture for handling hard forks:

- **Runtime** orchestrates variant lifecycle and state migration
- **Variants** are independent implementations for specific protocol versions
- **WalletBuilder** registers variants with the runtime
- **FacadeAPIAdapter** exposes domain-specific APIs through a common interface

This enables seamless state migration during hard forks and independent implementation/testing of variants.

### State Management Pattern

Uses BLoC-like pattern with Effect library:

- State is an immutable stream (`SubscriptionRef`) that can only be modified through dedicated methods
- **Capabilities**: Pure functional extensions to state (e.g., coin listing, balance computation)
- **Services**: Async/side-effecting operations (e.g., sync streams, proof generation)

Capabilities operate on state synchronously; services provide data that capabilities process.

## Code Patterns

### Effect Library Usage

Effect is the primary functional programming library. Key conventions:

- Use namespace imports for Effect types that conflict with globals:
  ```typescript
  import { Array as EArray, Record as ERecord } from 'effect';
  ```
- `SubscriptionRef` for atomic state updates with concurrent writers
- Typed error handling via `Either` and `Effect.fail`

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

### ESLint Rules

- Namespace declarations allowed (for Effect-style typing): `@typescript-eslint/no-namespace: allowDeclarations`
- Unused vars with `_` prefix are ignored
- Max line length: 120 characters

### TypeScript Configuration

- Target: ESNext with NodeNext module resolution
- Strict mode with `exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature`
- Effect language service plugin for enhanced DX

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

## Testing

- Uses Vitest with 30-second default timeout
- Environment variables via `.env` file (copy from `.env.example`)
- Test files in `test/` directories within each package
- Coverage reports generated to `coverage/` directory

## Versioning

Uses Changesets for semantic versioning:

- Add changeset: `yarn changeset add`
- Empty changeset (no release): `yarn changeset add --empty`
- Automated release PRs created by GitHub Actions
- Pre-release mode available for beta versions
