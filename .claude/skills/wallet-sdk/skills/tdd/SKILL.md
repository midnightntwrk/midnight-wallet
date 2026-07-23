---
name: tdd
description: >
  Test-driven development loop for the Midnight Wallet SDK. Use whenever implementing new behavior or fixing a bug in
  packages/**, or on any mention of TDD — the test is written, observed failing, and approved by the user BEFORE any
  implementation. Not needed for docs, config, or pure refactors with existing coverage.
---

# TDD Loop — Wallet SDK

**The test is the specification.** Once a test fails for the right reason, it must not be weakened to accommodate the
implementation. Work one test at a time.

## 0. Choose the test type — the filename suffix decides the CI lane

- `*.test.ts` — **unit**: pure, no Docker/network/infra. Use the in-memory `Simulator`, stubs, fakes. Must pass anywhere
  with zero setup.
- `*.integration.test.ts` — **integration**: needs live infra (testcontainers, indexer, node, prover). Gets its own
  parallel CI job automatically.
- Full wallet flows through the public API → e2e, in the `e2e-tests` package (not here).
- Never mix unit and integration in one file — split it.

## 1. Design the test

- Pin down the exact behavior and the precise assertions before writing anything.
- Prefer stubs/fakes over `vi.fn`/`vi.mock` — implement a stub object providing expected data.
- Design so the test can be implemented **without later modification**.

## 2. Write the test

One behavior, precise assertions — exactly what was designed in step 1.

## 3. Observe RED

```bash
yarn test --filter=@midnightntwrk/wallet-sdk-<package> -- test/<File>.test.ts
```

Confirm it fails **for the expected reason** — a failed assertion on the behavior under test. A type error, bad import,
or setup crash is not red; fix the test harness first.

## 4. GATE — stop for user review

Present the failing test to the user. The user reviews (and ideally commits) the test **before implementation begins**.
Do not proceed without approval.

## 5. Implement

The minimum code that makes the test pass. Follow the repo's functional rules (no mutation, Either for pure logic,
Effect at the I/O boundary).

## 6. Observe GREEN

Re-run the exact same command from step 3. All tests in the package still pass.

## 7. Review

Re-read the diff as a reviewer would; run `yarn verify:changed` (format + typecheck + lint + Effect diagnostics on what
you changed).

## 8. Consider refactor

Improve names/structure while tests stay green. Re-run the tests after.

## 9. Next item

Return to step 0 for the next behavior.

## If the implementation cannot pass the test as written

Do **not** weaken it — no loosened assertions (`toBe(5)` → `toBeGreaterThan(0)`), no "mock can't do X, so we check Y
instead" comments. Instead: gather every such case and present to the user — what the test expects, what currently
exists, why the gap exists, and proposed solutions (fix the fake, change the API design, …). Wait for the user's
decision.
