# Midnight Wallet SDK — Contributor Guide

TypeScript implementation of the Midnight Wallet Specification. Turbo monorepo, 16 packages, Yarn 4, Node 22, Effect library.

| File | What it covers |
|------|---------------|
| [FUNCTIONAL_PROGRAMMING.md](./FUNCTIONAL_PROGRAMMING.md) | Effect/Either patterns, immutability rules, typeclass patterns, canonical examples, Scala/F# idiom translation |
| [SKILLS.md](./SKILLS.md) | Custom slash commands (/pre-push, /test, /build, /new-capability, /check-fp) |
| [DEV_GUIDE.md](./DEV_GUIDE.md) | Branching strategy, changesets workflow, pre-release channels |
| [docs/Design.md](./docs/Design.md) | Architecture diagrams, three-token model, variant structure |
| [docs/decisions/](./docs/decisions/) | ADRs: BLoC pattern, Effect library, Variant/Builder/Facade |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | CLA, contribution process, license headers |

IMPORTANT: Use GitNexus tools (impact analysis, context, query) before modifying code. See GitNexus section below.

## Key People

| Person | Role | Reviews for |
|--------|------|-------------|
| **Andrzej Kopeć** (kapke) | Architect, FP authority | FP correctness, naming precision, API design, breaking changes. His reviews are authoritative — "use `reduce`", "these ARE breaking changes", "stick to original naming" |
| **Agron Murtezi** (agronmurtezi) | Primary developer | Wallet logic, e2e tests, security (secret key clearing), infrastructure |
| **Joe Tsang** (jtsang586) | Developer, test infrastructure | E2E tests, CI workflows, test hardening |
| **Adam Reynolds** (adamreynolds-io) | Engineering manager | Architectural review |

## Claude Code Settings

- **`.claude/settings.json`** is tracked by git — shared team config (hooks only). **NEVER** add `permissions` here.
- **`.claude/settings.local.json`** is gitignored — personal permissions go here.

## Key Specifications (ALWAYS CONSULT)

| Specification | Location |
|--------------|----------|
| Wallet Specification | [midnight-architecture](https://github.com/midnightntwrk/midnight-architecture) `components/WalletEngine/Specification.md` |
| DApp Connector API | [midnight-dapp-connector-api](https://github.com/input-output-hk/midnight-dapp-connector-api) `SPECIFICATION.md` |
| Ledger Specification | [midnight-ledger](https://github.com/input-output-hk/midnight-ledger) `spec/` (intents, zswap, dust, night, contracts, cost-model) |
| API Usage Examples | `packages/docs-snippets/` (transfers, swaps, balancing, initialization) |

IMPORTANT: Always refer to docs-snippets for API usage patterns when implementing new features.

## Architecture

### Three-Token Model

1. **Unshielded Wallet** — Night and other unshielded tokens on the public ledger
2. **Shielded Wallet** — Custom shielded tokens with zero-knowledge proof support
3. **Dust Wallet** — Dust for paying transaction fees. NEVER call Dust a "token". It is a resource generated from Night tokens whose sole purpose is fee payments.

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

**External communication:** indexer-client (GraphQL), node-client (Polkadot RPC), prover-client (ZK proofs)
**Key management:** hd (BIP32/BIP39), address-format (Bech32m)

### Variant/Runtime Pattern

```
WalletFacade → FacadeAPIAdapter → AWallet → WalletRuntime → RuntimeVariant(s)
```

Each variant follows a Services + Capabilities pattern:
- **Capability**: Pure functional state transformations (returns Either)
- **Service**: Async/side-effecting orchestration (uses Effect)

## Build & Tools

IMPORTANT: All commands run from repository root. Shared devDependencies are hoisted — commands won't resolve from package directories.

```bash
yarn dist                    # Build all packages (NOT yarn build)
yarn test                    # Unit tests (auto-builds upstream deps)
yarn verify                  # Full CI: typecheck + lint + tests
yarn format:check            # Check formatting
yarn changeset add           # Add changeset for versioning
```

### Effect Language Service

Configured in `tsconfig.base.json`. Project-enforced rules:
- `deterministicKeys: "error"` — `Data.TaggedError` keys must follow deterministic naming based on file path
- `importAliases: "error"` — Effect modules shadowing globals must use aliases: `Array→EArray`, `Record→ERecord`, `Number→ENumber`, `String→EString`, `Boolean→EBoolean`, `Function→EFunction`

```bash
# Run diagnostics on changed files
git diff --name-only --diff-filter=ACMR HEAD -- '*.ts' | xargs -I{} yarn effect-language-service diagnostics --file "$(pwd)/{}" --format pretty

# Package-level (must use tsconfig.build.json, NOT tsconfig.json)
yarn effect-language-service diagnostics --project "$(pwd)/packages/dust-wallet/tsconfig.build.json" --format pretty
```

## Key Dependencies

- **Effect** (`effect`) — FP primitives, `SubscriptionRef` for state, typed errors. Use namespace imports for globals: `import { Array as EArray } from 'effect'`
- **RxJS** (`rxjs`) — Observable streams, facade-level ONLY (not internal code)
- **@midnight-ntwrk/ledger-v8** — Core ledger types and ZK proof types

## Functional Programming (MANDATORY)

Full guide with examples and canonical files: [FUNCTIONAL_PROGRAMMING.md](./FUNCTIONAL_PROGRAMMING.md)

**Immutability — NEVER use:**
- `let` — use `const` only
- `for`/`while` — use `map`/`filter`/`reduce`/`flatMap`
- `array.push()`/`pop()`/`splice()` — these mutate
- `object[key] = value` — use spread `{ ...obj, key: value }`

**Either vs Effect — NOT interchangeable:**
- **Either** = pure synchronous (validation, state transforms, business logic)
- **Effect** = side-effecting (I/O, async, resources, DI)
- Convert at boundary only: `EitherOps.toEffect(pureResult)`

**Anti-patterns (NEVER DO):**

| Anti-Pattern | Correct Alternative |
|---|---|
| `Promise` in internal code | `Effect.tryPromise` |
| Throw for expected errors | `Either` or `Effect.fail` |
| `null`/`undefined` for optional | `Option` |
| Mutable class state | Refs + pure functions |
| Mix Effect and raw async/await | Effect composition |
| Validate and return boolean | Parse and return typed value |

**Effect boundaries** (per ADR 0006): Internal code uses Effect. Facade APIs expose Promise/RxJS. Never require Effect knowledge from SDK consumers.

**Import aliases required:** `Array→EArray`, `Record→ERecord`, `Number→ENumber`, `String→EString`, `Boolean→EBoolean`, `Function→EFunction`

**Type casts:** Exhaust type guards, generics, narrowing first. If unavoidable, add justification comment.

## TDD (MANDATORY)

**The test is the specification.** Once written and confirmed failing, tests MUST NOT be changed to accommodate implementation.

1. Design the test thoroughly before writing it
2. Write the test with precise assertions
3. Verify it fails for the expected reason (red)
4. User reviews and commits tests before implementation begins
5. Implement code to make the test pass (green)

If implementation cannot pass the test as written: gather ALL failing cases, present to the user with what/why/proposed solutions. Wait for user decision. Do NOT weaken assertions.

Avoid `vi.fn`/`vi.mock` — use stubs and fakes instead. See [FUNCTIONAL_PROGRAMMING.md](./FUNCTIONAL_PROGRAMMING.md) for testing Effect code patterns.

## CI Pipeline

| Check | What it checks |
|-------|----------------|
| Build | `yarn dist` all packages, upload artifacts |
| General Checks | Typecheck, format check, lint (depends on build) |
| Tests | Unit tests + smoke e2e (16-core runner, depends on general checks) |
| Publish Checks | publint validation |
| Changeset Check | Verifies changeset file exists for releasable changes |
| License Headers | Apache 2.0 header on `.ts`, `.js`, `.sh`, `Dockerfile*` |

Release: Changesets GitHub Action creates release PR on main, auto-publishes to GitHub Packages on merge. Canary snapshots published on every main push.

## Common Mistakes

1. **Using `let`/`for`/`push`** — Mandatory immutability. Use `reduce`/`map`/`filter`. See [FUNCTIONAL_PROGRAMMING.md](./FUNCTIONAL_PROGRAMMING.md).
2. **Mixing Either and Effect** — Either for pure synchronous logic, Effect for side-effecting. Never wrap Either inside Effect for pure computations.
3. **Calling Dust a "token"** — It's a resource for fee payment, generated from Night tokens. Reviewers will reject this.
4. **Running commands from package directories** — Must run from root. Shared deps are hoisted.
5. **Forgetting `yarn dist` after changes** — Downstream packages won't see updated types/code. "Module not found" errors.
6. **Turbo cache stale after branch switch** — Use `--force` to bypass: `yarn dist --force`, `yarn test --force`.
7. **Using `vi.fn`/`vi.mock`** — Use stubs/fakes instead. Mocks break encapsulation.
8. **Weakening tests to fit implementation** — Test is the specification. If it can't pass, report to user, don't change assertions.
9. **Missing changeset** — CI checks for it. Use `yarn changeset add` (or `--empty` for non-release changes).
10. **Type casts without justification** — Exhaust type guards, generics, narrowing first. If unavoidable, add comment explaining why.
11. **Using Promise/async-await internally** — Wrap in `Effect.tryPromise`. Only facades expose Promise/RxJS.
12. **`--project` pointing to wrong tsconfig** — Effect Language Service needs `tsconfig.build.json`, not `tsconfig.json`.

## Downstream Impact

| If you change... | Impact | Action |
|-----------------|--------|--------|
| `abstractions/` interfaces | All wallet implementations break | Coordinate with kapke — breaking change |
| `facade/` public API | All SDK consumers break | Major version bump, changeset required |
| `capabilities/` | All wallet implementations affected | Run full test suite |
| `utilities/` | Everything depends on it | Run full test suite |
| `runtime/` variant pattern | Wallet lifecycle affected | Test variant migration paths |

## Transaction Inspection

Key types from `@midnight-ntwrk/ledger-v8`:
- `Transaction<Signaturish, Proofish, Bindingish>` — controls signature/proof/binding state
- `FinalizedTransaction` = `Transaction<SignatureEnabled, Proof, Binding>` — ready for submission
- Segments: 0 = guaranteed, 1-65535 = fallible
- `tx.imbalances(segmentId)` returns `Map<TokenType, bigint>` — zero means balanced

Key test examples: `packages/dapp-connector-reference/src/test/transfer.test.ts`, `packages/docs-snippets/`

## Documentation Standards

Public APIs require JSDoc: description, `@param`, `@returns`, `@throws` (facade APIs), `@example`.

Browser builds require polyfills for Node's `Buffer` and `assert`.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **midnight-wallet** (1713 symbols, 4520 relationships, 84 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/midnight-wallet/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/midnight-wallet/context` | Codebase overview, check index freshness |
| `gitnexus://repo/midnight-wallet/clusters` | All functional areas |
| `gitnexus://repo/midnight-wallet/processes` | All execution flows |
| `gitnexus://repo/midnight-wallet/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## CLI

- Re-index: `npx gitnexus analyze`
- Check freshness: `npx gitnexus status`
- Generate docs: `npx gitnexus wiki`

<!-- gitnexus:end -->
