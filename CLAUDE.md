# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The Midnight Wallet SDK is a TypeScript implementation of the
[Midnight Wallet Specification](https://github.com/midnightntwrk/midnight-architecture/blob/main/components/WalletEngine/Specification.md).
It provides key generation, address formatting, transaction building, state syncing with the indexer, and testing
utilities for the Midnight privacy-focused blockchain.

## Documentation Map

| Topic                                               | Where                                      |
| --------------------------------------------------- | ------------------------------------------ |
| Contribution workflow                               | `CONTRIBUTING.md`                          |
| Branching, changesets, releases                     | `DEV_GUIDE.md`                             |
| Architecture (variants, state, diagrams)            | `docs/Design.md`, `docs/decisions/` (ADRs) |
| Functional programming conventions (full, examples) | `docs/CodingConventions.md`                |
| Claude Code setup (permissions, hooks, scripts)     | `docs/ClaudeCode.md`                       |

Hard rules load automatically from `.claude/rules/` when matching files are touched: `functional-style.md` (SDK code),
`testing.md` (tests), `transactions.md` (transaction-handling packages).

## Claude Code Settings

- **`.claude/settings.json`** is tracked by git — shared team config (hooks only). **NEVER** add `permissions` here.
- **`.claude/settings.local.json`** is gitignored — personal permissions go here.

## Git & GitHub Conventions

- **Never commit or push directly to `main`** — always work on a branch (naming: see `DEV_GUIDE.md` → Branching
  Strategy).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <description>`
  — imperative mood, lower-case, no trailing period. Breaking changes: `!` after type/scope and/or a `BREAKING CHANGE:`
  footer.
- **Never commit, push, or create/edit PRs or issues unattended** — show the user the diff and the exact commit message
  (or PR/issue content) first, and wait for explicit approval.
- Issues and PRs must use the templates in `.github/` — fill in every section and link the related issue
  (`Closes #123`).

## Key Specifications (ALWAYS CONSULT)

Consult the spec instead of guessing protocol or API semantics. If [shelf](#code-reference-repos-shelf) is installed,
these repos are cached locally under `~/.agents/shelf/repos/<name>/` — read them there instead of the web.

| Spec               | Repository                                  | Path                                       | Covers                                                                      |
| ------------------ | ------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| Wallet             | `midnightntwrk/midnight-architecture`       | `components/WalletEngine/Specification.md` | Transaction/coin lifecycle, balance types, state operations, sync           |
| Ledger             | `midnightntwrk/midnight-ledger`             | `spec/*.md`                                | `intents-transactions`, `zswap`, `dust`, `night`, `contracts`, `cost-model` |
| DApp Connector API | `midnightntwrk/midnight-dapp-connector-api` | `SPECIFICATION.md`, types in `src/api.ts`  | API design, method signatures, error handling                               |

**API usage examples:** `packages/docs-snippets` — working code for shielded/unshielded/combined transfers, swap,
balancing, and wallet initialization. **Always refer to docs-snippets for API usage patterns when implementing new
features.**

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
yarn dist --filter=@midnightntwrk/wallet-sdk-facade

# Build and watch for changes
yarn watch

# Run the full suite (unit + integration)
yarn test

# Run ONLY unit tests (pure, no Docker/network — fast, runs anywhere)
yarn test:unit

# Run ONLY integration tests (require Docker/testcontainers)
yarn test:integration

# Run tests for specific package
yarn test --filter=@midnightntwrk/wallet-sdk-unshielded-wallet

# Run specific test file
yarn test --filter=@midnightntwrk/wallet-sdk-unshielded-wallet -- test/UnshieldedWallet.test.ts

# Full CI verification (typecheck, lint, tests)
yarn verify

# Format / lint / Effect diagnostics for changed files only (what the hooks run)
yarn format:changed
yarn lint:changed
yarn els:changed
yarn verify:changed

# Clean all build artifacts
yarn clean

# Check for missing changesets
yarn changeset:check
```

### Effect Language Service

`@effect/language-service` provides Effect-specific diagnostics (floating effects, wrong yield usage, deterministic
keys, …), configured as a TypeScript plugin in `tsconfig.base.json`. The Stop hook runs `yarn els:changed` over changed
files automatically; to run it by hand:

```bash
# Single file (always absolute paths — prefix with $(pwd)/)
yarn effect-language-service diagnostics --file "$(pwd)/path/to/file.ts" --format pretty

# Whole package — must use tsconfig.build.json or tsconfig.test.json, NOT tsconfig.json
# (the latter only has references, no source files)
yarn effect-language-service diagnostics --project "$(pwd)/packages/dust-wallet/tsconfig.build.json" --format pretty
```

Other subcommands: `quickfixes` (report-only diffs), `codegen` (applies `@effect-codegens` directives — writes changes),
`overview`, `layerinfo`.

### Code Reference Repos (Shelf)

Optional: [shelf](https://github.com/Rika-Labs/shelf) caches the upstream reference repos declared in `shelffile` (the
midnight specs above, `effect`, the language-service) locally for fast access. Install: `bun install -g @rikalabs/shelf`
then `shelf install`.

## Architecture

For detailed architecture documentation with diagrams, see `docs/Design.md` and `docs/decisions/` (ADRs). Key ADRs: 0001
(BLoC pattern for state), 0004 (Effect library), 0006 (Variant/Builder/Facade architecture).

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

Each variant follows a Services + Capabilities pattern: **services** are async/side-effecting objects (sync streams,
proving, submission); **capabilities** are pure functional state transformations (balances, coin selection).
Capabilities operate on state synchronously; services provide data that capabilities process. State lives in
`SubscriptionRef` (BLoC-like: immutable, observable, atomically updated).

## Key Dependencies

- **Effect** (`effect`) - Functional programming primitives, `SubscriptionRef` for state. Typed errors via `Either`
  (pure/synchronous context) and `Effect.fail` (side-effectful one).
- **RxJS** (`rxjs`) - Observable streams; only in APIs exposed to users of the SDK.
- **@midnight-ntwrk/ledger-v8** - Core ledger types and ZK proof types.

## Testing

Tests use Vitest; each package has its own `vitest.config.ts` with `unit` and `integration` projects. Split by
**filename suffix** — pick it by whether the test needs live infra to pass:

- **Unit** — `*.test.ts`: pure, no Docker/network/external services. `yarn test:unit`.
- **Integration** — `*.integration.test.ts`: needs infra (Docker/testcontainers, indexer, node, prover).
  `yarn test:integration`. In CI every integration file automatically gets its own parallel job (own runner + Docker
  stack).
- **E2E** — full wallet flows through the public API belong in `packages/e2e-tests` as `*.undeployed.test.ts` (smoke
  subset on PRs, full suite nightly), not in the integration tier.

The required merge check is the aggregate **`Tests`** job — it gates on all three tiers. Detailed test rules (never mix
kinds in one file, the unit-project `exclude` gotcha, Effect test patterns) load automatically from
`.claude/rules/testing.md` when test files are touched.

**TDD is mandatory** for feature and bug-fix work: design the test, observe it fail for the expected reason, let the
user review and commit it, then implement. **A confirmed-failing test must never be weakened to fit the implementation**
— escalate to the user instead. Follow the `tdd` skill (from the `wallet-sdk` plugin) for the full loop.

For tests requiring infrastructure: `cp .env.example .env` and set `APP_INFRA_SECRET` (`openssl rand -hex 32`).

## Versioning

Uses [Changesets](https://github.com/changesets/changesets): every releasable change needs a changeset (docs/tooling
changes need an empty one). Use the `changeset` skill (from the `wallet-sdk` plugin) — `yarn changeset add` is
interactive; the skill writes the file directly. Verify with `yarn changeset:check`. Release process: `DEV_GUIDE.md`.

## Coding Standards

This codebase follows functional programming principles **rigorously** — immutability (no `let`/loops/mutation),
`Either` for pure logic vs `Effect` for side effects, parse-don't-validate, total functions, tagged errors. The hard
rules load automatically from `.claude/rules/functional-style.md` when SDK code is touched; full rationale, worked
examples, and canonical pattern files are in `docs/CodingConventions.md`.

Public APIs require JSDoc: description, `@param` for each parameter, `@returns`, `@throws` (facade APIs that throw), and
an `@example` with a working snippet (worked example: `docs/CodingConventions.md` → Documentation Standards).

## Downstream Impact

| If you change...           | Impact                              | Action                                      |
| -------------------------- | ----------------------------------- | ------------------------------------------- |
| `abstractions/` interfaces | All wallet implementations break    | Breaking change — coordinate before merging |
| `facade/` public API       | All SDK consumers break             | Major version bump, changeset required      |
| `capabilities/`            | All wallet implementations affected | Run full test suite                         |
| `utilities/`               | Everything depends on it            | Run full test suite                         |
| `runtime/` variant pattern | Wallet lifecycle affected           | Test variant migration paths                |

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
