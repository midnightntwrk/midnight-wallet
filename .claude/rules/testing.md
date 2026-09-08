---
paths:
  - '**/*.test.ts'
  - '**/vitest.config.ts'
  - 'packages/**/test/**'
  - 'packages/e2e-tests/**'
---

# Testing — hard rules

## Which kind of test (pick the filename suffix first)

- **Unit** — `*.test.ts`. Pure: no Docker, no network, no external services. In-memory `Simulator`, injected fakes. Must
  pass anywhere with zero setup. Run: `yarn test:unit`.
- **Integration** — `*.integration.test.ts`. Requires live infra (testcontainers, indexer, node, prover). Each file gets
  its own parallel CI job automatically. Run: `yarn test:integration`.
- **End-to-end** — full wallet flows through the public API belong in `packages/e2e-tests` as `*.undeployed.test.ts`
  (`.remote`/`.universal` variants target deployed networks), not in the integration tier.
- **Fork crossing** — `*.fork.test.ts` in `packages/e2e-tests` (`yarn turbo test-fork`, own nightly workflow
  `.github/workflows/e2e-hard-fork.yml`) is the only lane that enacts the real ledger 8 → 9 runtime upgrade; every other
  stack runs ledger-v9 from block 1. New fork-crossing behaviour that needs live infra belongs there, not in
  `*.undeployed.test.ts`. Details: `packages/e2e-tests/README.md`.

Never mix kinds in one file — split it (see `BlockHash.test.ts` / `BlockHash.integration.test.ts` in `indexer-client`).
When adding a vitest project, the `unit` project must `exclude` `**/*.integration.test.ts` — the default `**/*.test.ts`
glob matches integration files too.

Run from the repo root only (deps are hoisted; commands don't resolve inside package dirs):
`yarn test --filter=@midnightntwrk/wallet-sdk-<package> -- test/<File>.test.ts`.

## TDD contract (mandatory — full loop: the `tdd` skill from the `wallet-sdk` plugin)

- Design the test thoroughly, write it, and **observe it fail for the expected reason** before implementing.
- The user reviews/commits tests before implementation starts.
- **A written, confirmed-failing test must never be weakened** to accommodate implementation difficulties — no loosened
  assertions, no "mock can't do X so check Y instead". If implementation cannot pass the test as written, stop and
  present the gap to the user (what the test expects, what exists, why, proposed solutions). The test is the
  specification.

## Test doubles

- Prefer real objects, then hand-written stubs/fakes providing expected data. Reach for `vi.fn`/`vi.mock` only when a
  fake is impractical.
- Fake Effect services with a Layer: `Layer.succeed(UserService, { fetch: () => Effect.succeed(stubUser) })`, provided
  via `Effect.provide`.

## Testing Effect code

- Unwrap with `Effect.runPromise` (or `Effect.runSync` for pure effects).
- Expected failures: `const exit = await Effect.runPromiseExit(...)` then assert `Exit.isFailure(exit)` / match the
  tagged error — never try/catch around a thrown Effect.
