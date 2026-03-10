# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The Midnight Wallet SDK is a TypeScript implementation of the
[Midnight Wallet Specification](https://github.com/midnightntwrk/midnight-architecture/blob/main/components/WalletEngine/Specification.md).
It provides key generation, address formatting, transaction building, state syncing with the indexer, and testing
utilities for the Midnight privacy-focused blockchain.

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

**IMPORTANT: Always follow Test-Driven Development (TDD)**
When implementing new features or fixing bugs:
1. Write tests first that define the expected behavior
2. Run tests to verify they fail (red)
3. Only then implement the code to make tests pass (green)
4. User reviews and commits tests before implementation begins

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

## Web Packaging Note

Browser builds require polyfills for Node's `Buffer` and `assert`.
