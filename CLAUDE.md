# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The Midnight Wallet SDK is a TypeScript implementation of the
[Midnight Wallet Specification](https://github.com/midnightntwrk/midnight-architecture/blob/main/components/WalletEngine/Specification.md).
It provides key generation, address formatting, transaction building, state syncing with the indexer, and testing
utilities for the Midnight privacy-focused blockchain.

## Documentation Map

| Topic                                                 | Where                                      |
| ----------------------------------------------------- | ------------------------------------------ |
| Contribution workflow                                 | `CONTRIBUTING.md`                          |
| Setup, branching, testing tiers, changesets, releases | `DEV_GUIDE.md`                             |
| Architecture (variants, state, diagrams)              | `docs/Design.md`, `docs/decisions/` (ADRs) |
| Functional programming conventions (full, examples)   | `docs/CodingConventions.md`                |
| Claude Code setup (permissions, hooks, scripts, ELS)  | `docs/ClaudeCode.md`                       |

Hard rules load automatically from `.claude/rules/` when matching files are touched: `functional-style.md` (SDK code),
`testing.md` (tests), `transactions.md` (transaction-handling packages), `claude-config.md` (`.claude/**`).

**Specs over guesses:** never guess protocol or API semantics — consult the wallet spec
(`midnightntwrk/midnight-architecture`), ledger spec (`midnightntwrk/midnight-ledger` → `spec/`), or DApp Connector API
(`midnightntwrk/midnight-dapp-connector-api`); the `shelf` skill reads them from a local cache. **API usage examples:**
`packages/docs-snippets` — always check there first when implementing against the public API.

## Git & GitHub Conventions

- **Never commit or push directly to `main`** — always work on a branch (naming: `DEV_GUIDE.md` → Branching Strategy).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <description>`
  — imperative mood, lower-case, no trailing period. Breaking changes: `!` after type/scope and/or a `BREAKING CHANGE:`
  footer.
- **Never commit, push, or create/edit PRs, issues, or comments unattended** — show the user the diff and the exact
  message/content first, and wait for explicit approval.
- Issues and PRs use the `.github/` templates, every section filled. Link issues with plain references (`#123`) —
  **never** closing keywords (`Closes`/`Fixes`/`Resolves`); issues are closed manually after QA.

## Build Commands

Run everything from the repository root — shared devDependencies are hoisted, so commands don't resolve inside package
directories. Use `--filter` to target one package.

```bash
yarn                  # install dependencies
yarn dist             # build all packages (--filter=@midnightntwrk/wallet-sdk-facade for one)
yarn watch            # build and watch
yarn test             # full suite; yarn test:unit = fast/no infra, yarn test:integration = Docker
yarn test --filter=@midnightntwrk/wallet-sdk-unshielded-wallet -- test/UnshieldedWallet.test.ts
yarn verify           # full CI verification (typecheck, lint, tests)
yarn verify:changed   # format → lint → Effect diagnostics on changed files (what the Stop hook runs)
```

Effect-specific diagnostics (`@effect/language-service`) run automatically via the Stop hook; manual invocation and
subcommands: `docs/ClaudeCode.md`.

## Architecture

Full documentation with diagrams: `docs/Design.md` + ADRs (0001 BLoC state, 0004 Effect, 0006 Variant/Builder/Facade).

Three token types/resources, each with its own wallet package, addresses, and state:

1. **Unshielded** — Night and other unshielded tokens on the public ledger
2. **Shielded** — custom shielded tokens with zero-knowledge proofs
3. **Dust** — fee-payment resource generated from Night. **Never call Dust a "token".**

```
facade              ← Unified API combining all wallet types
   ├── shielded-wallet / unshielded-wallet / dust-wallet
          ↓
runtime             ← Wallet lifecycle/variant orchestration for hard-forks
   ├── abstractions ← Interfaces that variants must implement
   └── capabilities ← Shared implementations (coin selection, tx balancing)
          ↓
utilities           ← Common types and operations
```

Plus external clients (`indexer-client` GraphQL, `node-client` Polkadot RPC, `prover-client` ZK proofs) and key
management (`hd` BIP32/BIP39, `address-format` Bech32m). Each protocol-version variant follows Services (side-effecting:
sync, proving, submission) + Capabilities (pure state transforms) with state in `SubscriptionRef` — details in ADR 0006.

## Testing

**TDD is mandatory** for feature and bug-fix work: design the test, observe it fail for the expected reason, let the
user review and commit it, then implement. **A confirmed-failing test must never be weakened to fit the implementation**
— escalate to the user instead. Full loop: the `tdd` skill.

Tests split by filename suffix — unit `*.test.ts` (pure, no infra) vs integration `*.integration.test.ts`
(Docker/testcontainers) vs e2e (`packages/e2e-tests`). Hard rules load from `.claude/rules/testing.md`; tiers, CI
matrix, and local infra setup: `DEV_GUIDE.md` → Testing Tiers & CI.

## Versioning

Every releasable change needs a changeset (docs/tooling changes need an empty one) — use the `changeset` skill. Release
process: `DEV_GUIDE.md`.

## Coding Standards

This codebase follows functional programming principles **rigorously** — immutability (no `let`/loops/mutation),
`Either` for pure logic vs `Effect` for side effects, parse-don't-validate, total functions, tagged errors. The hard
rules (including JSDoc requirements for public APIs) load from `.claude/rules/functional-style.md` when SDK code is
touched; full rationale and worked examples: `docs/CodingConventions.md`.

## Common Gotchas

- **ESM + project references: downstream packages see stale types until `yarn dist`** — imports resolve to sibling
  packages' `dist/` output, so "module not found"/stale-type errors usually mean a missing rebuild.
- **Turbo builds dependencies for you** for `test`, `typecheck`, and `lint` (`dependsOn: ["^dist"]`) — no manual
  `yarn dist` needed before `yarn test`.
- **Turbo's cache can be stale** after branch switches, rebases, or changes it doesn't track — bypass with `--force`
  (`yarn dist --force`, `yarn test --force`).
