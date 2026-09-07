# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The Midnight Wallet SDK is a TypeScript implementation of the
[Midnight Wallet Specification](docs/spec/Specification.md). It provides key generation, address formatting, transaction
building, state syncing with the indexer, and testing utilities for the Midnight privacy-focused blockchain. Both the
specification and its executable [reference implementation](packages/spec-reference) — which generates and verifies the
spec's test vectors — live in this repository, at `docs/spec/` and `packages/spec-reference/`.

## Documentation Map

| Topic                                                 | Where                                      |
| ----------------------------------------------------- | ------------------------------------------ |
| Contribution workflow                                 | `CONTRIBUTING.md`                          |
| Setup, branching, testing tiers, changesets, releases | `DEV_GUIDE.md`                             |
| Architecture (variants, state, diagrams)              | `docs/Design.md`, `docs/decisions/` (ADRs) |
| Functional programming conventions (full, examples)   | `docs/CodingConventions.md`                |
| Claude Code setup (permissions, hooks, scripts, ELS)  | `docs/ClaudeCode.md`                       |

Hard rules load automatically from `.claude/rules/` when matching files are touched: `functional-style.md` (SDK code),
`testing.md` (tests), `transactions.md` (transaction-handling packages), `spec-reference.md` (key derivation / address
formatting), `claude-config.md` (`.claude/**`).

**Specs over guesses:** never guess protocol or API semantics — consult the wallet spec (`docs/spec/Specification.md`,
in-repo), the ledger spec (`midnightntwrk/midnight-ledger` → `spec/`), or the DApp Connector API
(`midnightntwrk/midnight-dapp-connector-api`); the `shelf` skill caches the external spec repos locally. **API usage
examples:** `packages/docs-snippets` — always check there first when implementing against the public API.

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

# --- Rust / WASM (only packages/state-translation) ---
# Build the v8-to-v9 state translation WASM. NOT part of `yarn dist`; turbo runs it automatically before the
# integration tests in capabilities and state-translation, which declare a dependency on it.
yarn turbo run build:wasm --filter=@midnightntwrk/wallet-sdk-state-translation
# Confirm a built artifact actually translates (compiling proves little — see the package's wasm/README.md)
yarn workspace @midnightntwrk/wallet-sdk-state-translation verify:wasm
```

Effect-specific diagnostics (`@effect/language-service`) run automatically via the Stop hook; manual invocation and
subcommands: `docs/ClaudeCode.md`.

### Rust toolchain

The repo is TypeScript apart from one crate, `packages/state-translation/wasm`, which wraps the ledger's v8-to-v9 state
translation. **`dist`, `typecheck`, `lint` and `test:unit` need no Rust**; only the integration tests in `capabilities`
and `state-translation` do, because their `test:integration` depends on the state-translation package's `artifacts`
task, which builds and verifies the WASM.

Requires `rustup` (the toolchain and wasm32 target come from the root `rust-toolchain.toml`), `wasm-bindgen-cli` at
**exactly 0.2.104**, `binaryen` for `wasm-opt`, and on macOS Homebrew's `llvm` — Apple's clang cannot target wasm32.

The root `Cargo.toml` is the Rust workspace; it holds the `[patch.crates-io]` block and the `wasm` profile, because
Cargo only honours those in a workspace root. **Do not run `cargo` directly** — the build script materializes a
vendored, patched `midnight-storage` that the `[patch]` points at, so a bare `cargo build` fails on the missing
directory. See `packages/state-translation/wasm/README.md`.

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

### Two ledgers, side by side

The SDK runs ledger-v8 below the protocol boundary and ledger-v9 from it, so both are installed and both are real:

- **`@midnight-ntwrk/ledger-v8`** — ledger-v8, run by the `v1` variants below `forks.v9`
- **`@midnightntwrk/ledger-v9`** — ledger-v9, run by the `v2` variants from `forks.v9`
- **Watch the scope.** `@midnight-ntwrk` (hyphenated) and `@midnightntwrk` (not) are **two different npm orgs**, and the
  two ledgers are published under different ones. One character decides which package you import; getting it wrong
  yields a module-not-found for a package that plainly exists. Copy the specifier, do not type it.
- Never hardcode a ledger version in SDK code that a wallet runs. Version travels as `ProtocolVersion` data;
  `packages/abstractions/src/WalletTransaction.ts` is how a transaction carries the version that built it.

### The v1/v2 Twin Convention

Each of the three wallet packages holds **two variants of the same wallet**, one per ledger version, in sibling
directories under `src/`:

- **`src/v1`** - the **V1** variant, on `@midnight-ntwrk/ledger-v8`. Active below the chain's `forks.v9`.
- **`src/v2`** - the **V2** variant, on `@midnightntwrk/ledger-v9`. Active from `forks.v9` upwards.

The two trees are near-identical modulo the ledger import: same file names, same exports with `V1`/`V2` in their names.

**Working rule: edit `v2`, then mirror the change into `v1` with the ledger swapped.** `v2` is where a change belongs
first, because it is what the chain runs from `forks.v9`. A change that lands in only one twin is a bug that shows up as
a wallet that misbehaves on one side of the fork.

**Justified `v9`-only exclusions.** A few things are deliberately absent from `v1` because no published ledger-v8 has
the API they need — the largest is dust's projections-based fast sync (`makeEventLessSyncService`), which rests on
`DustLocalState` members that exist only in v9 and cannot be back-ported. These are permanent, not gaps to be closed;
each is documented where it is excluded. Do not "fix" a missing `v1` counterpart without checking whether it is one of
them.

**The wallet layer above the twins is single.** `ShieldedWallet` / `DustWallet` / `UnshieldedWallet` each register both
variants and hand over at `configuration.forks.v9`; the package's own `Default*Configuration` is declared by the
package, not aliased to either variant's. `Custom*Wallet(configuration, builder)` is the single-variant composition. The
wallet packages require `forks`; only the facade presets it (`DefaultForkSchedule`), handing every factory in
`InitParams` a `ResolvedConfiguration` with it filled in, and `WalletFacade.resolveConfiguration` gives code outside a
factory the same one. Do not push the preset down into the wallets or remove it from the facade — the facade README says
why it sits exactly there.

### Naming the two sides of a fork

Names say **which version**, never **which side of the fork**. Two axes, decided by what a thing is:

- **Wallet code is `V1`/`V2`.** Anything under a twin tree, and any variant, builder, tag, sync update, core wallet or
  wallet error, carries the variant ordinal: `V1Builder`, `V1ShieldedVariant`, `TV1SyncUpdate`, `v1Builder`. V1 runs on
  ledger-v8 below `forks.v9`; V2 runs on ledger-v9 from it. The ordinal is not the ledger major, because a variant is a
  wallet implementation and more than one could serve a ledger version.
- **Ledger code is `V8`/`V9`.** Anything typed by a ledger package or standing for one ledger's runtime - transactions,
  keys, parameters, signatures, proving backends, validators, simulators, and the protocol-version epochs and stamps
  that say which ledger made some bytes - carries the ledger version: `V8UnprovenTransaction`, `makeV9Backend`,
  `v8Authoring`, `forks.v9`, `provers.v8`, `v8ProvingService.ts`, and `ledger-v8`/`ledger-v9` in prose.
- **An intermediary is named for what it is.** A variant type over ledger-v8 material is `V1ShieldedVariant`; a
  conversion returning a ledger object is `asV8DustParameters`; one returning the v1 tree's own type is `asV1PublicKey`.
- **Pairs are symmetric.** Where a v8-named thing has a twin, the twin is v9-named, never bare or "current". A file that
  imports both ledgers aliases them `ledgerV8` and `ledgerV9`; bare `ledger` belongs only in a file that imports one,
  which is what the twin trees do.
- **Relative words are fine when relative to a parameter, not to the fork**: `PreviousLedgerWallet` and
  `migrateState(previousState)` are relative to the variant at hand, `currentVariant` and `nextProtocolVersion` in the
  runtime to runtime state. Fork-neutral words stay too: `forks`, `ForkSchedule`, `forkVersion` for the boundary itself,
  `epochOf`, `*KeysByEpoch`, `Settled`/`Crossing`, `ForkSimulator`, `advanceToFork`, "hands over", "boundary".
- **Prose** writes `ledger-v8`/`ledger-v9` or "the V1/V2 variant", says "below `forks.v9`" / "from `forks.v9`" for the
  ranges, and names a fork by the version it introduces ("the v9 fork") wherever "the fork" could mean more than one.

Never name a side by its position relative to the fork, or by recency. `scripts/check-fork-vocabulary.mjs` holds the
retired words and fails `verify:check` and CI on any of them, in identifiers and prose alike; a line carrying
`fork-vocabulary: allow`, or a region between `fork-vocabulary: allow-start` and `fork-vocabulary: allow-end`, is exempt
for the few places that must quote one, such as a changeset's before/after table.

## Testing

**TDD is mandatory** for feature and bug-fix work: design the test, observe it fail for the expected reason, let the
user review and commit it, then implement. **A confirmed-failing test must never be weakened to fit the implementation**
— escalate to the user instead. Full loop: the `tdd` skill.

Tests split by filename suffix — unit `*.test.ts` (pure, no infra) vs integration `*.integration.test.ts`
(Docker/testcontainers) vs e2e (`packages/e2e-tests`). The e2e package also holds the `fork` lane (`*.fork.test.ts`),
the only stack that crosses a real ledger 8 → 9 runtime upgrade; new fork-crossing behaviour that needs live infra
belongs there. Hard rules load from `.claude/rules/testing.md`; tiers, CI matrix, and local infra setup: `DEV_GUIDE.md`
→ Testing Tiers & CI.

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
- **Two npm scopes, one character apart** — `@midnight-ntwrk/ledger-v8` and `@midnightntwrk/ledger-v9` live in different
  orgs (see Two ledgers, side by side); a module-not-found for a ledger that is plainly installed is almost always the
  hyphen.
