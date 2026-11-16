# Wallet SDK QA Test Execution and Report Summary — 2.0.1

## Overview

| Field                | Value                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Date                 | 16 November 2026                                                                                                       |
| QA Contact           | Joe Tsang (joe.tsang@shielded.io)                                                                                      |
| wallet-sdk version   | 2.0.1, the published npm packages (gitHead `304fd591`); abstractions 3.0.0 and hd 4.0.0 are unchanged from 2.0.0       |
| Ledger               | `@midnightntwrk/ledger-v8` 8.1.3, `@midnightntwrk/ledger-v9` 1.0.2, `@midnightntwrk/zkir-v2` 2.2.0, `zkir-v3` 3.2.1    |
| Node version         | 2.1.101                                                                                                                |
| Indexer version      | 4.4.101                                                                                                                |
| Proof server version | 9.0.2                                                                                                                  |
| QA Sign-off          | ⚠️ no failures; 1 e2e test passed only on its retry, and fails alone on its first attempt (a test-harness race, below) |

## Test Execution Summary

```
┌─────────────┬──────────────────────────┬────────┬────────┬─────────┬───────┐
│ Environment │ Suite                    │ Passed │ Failed │ Skipped │ Total │
├─────────────┼──────────────────────────┼────────┼────────┼─────────┼───────┤
│ undeployed  │ e2e (published packages) │    104 │      0 │       6 │   110 │
│ undeployed  │ docs-snippets            │     21 │      0 │       0 │    21 │
│ local       │ unit + integration       │   4104 │      0 │      32 │  4136 │
└─────────────┴──────────────────────────┴────────┴────────┴─────────┴───────┘
```

### e2e

One run of the full undeployed lane against the published 2.0.1 packages (17 files, run in parallel), 455 s, with the
suite's own `retry: 1`. Raw results: [undeployed/e2e/junit-test-results.xml](undeployed/e2e/junit-test-results.xml).

The 6 skips are static `.skip`s in the test source. Vitest exited 1 because its HTML reporter threw
`Do not know how to serialize a BigInt` after the JUnit and JSON reports were written; no test failed.

**Passed on retry:** `tokenTransfer.undeployed.test.ts:536` › "Able to pay fees for already balanced transaction to
complete swap". Its first attempt failed with
`Wallet.InsufficientDustForFee: Insufficient generated dust to cover registration fee (have 206675000000000, need 210703927484802). Generated dust should cover it in about 1 s`.
Re-run alone with `--retry 0` it fails the same way (17 passed, 1 failed, 1 skipped), so this is not load-dependent.

- **Verified:** the test sends Night to a fresh wallet and calls `registerNightUtxosForDustGeneration` without first
  calling `waitForGeneratedDust`. The SDK refuses with its documented precondition error, which names that wait, and the
  second attempt passes once the Dust has accrued.
- **Not established:** why the first attempt now fails consistently, when a solo run of this file passed on the 2.0.0
  canary. It was not bisected.

### docs-snippets and unit + integration

A workspace build of the release commit `304fd591`, not the published packages: `yarn test` across all 20 test packages,
then the docs-snippets undeployed suite. Three suites (`state-translation`, `capabilities` `forkStateTranslation`,
`shielded` `forkSimulation`) first failed to import the state-translation WASM. The combined `test` task does not build
the WASM; only `test:integration` depends on it. After `yarn turbo run build:wasm` and `verify:wasm`, all three packages
passed in full. The table counts those re-runs.

## Test Execution Guide

e2e, from the repository root at gitHead `304fd591`, with `packages/e2e-tests` resolving the published 2.0.1 packages
rather than the workspace, and the infra secrets from the e2e README:

```bash
export NETWORK=undeployed
export SYNC_CACHE=<empty directory>
export APP_INFRA_SECRET=...   # and the APP_INFRA_*_PASSWORD variables
cd packages/e2e-tests && yarn test-undeployed
```

Unit, integration and docs-snippets, from the repository root at the same commit, with `wasm-bindgen` 0.2.108 on `PATH`:

```bash
export APP_INFRA_SECRET=...   # and the APP_INFRA_*_PASSWORD variables
yarn turbo run build:wasm --filter=@midnightntwrk/wallet-sdk-state-translation
yarn test --force --concurrency=4 --continue
yarn turbo run test-undeployed --filter=@midnightntwrk/wallet-sdk-docs-snippets --force
```

Node 24 (`.nvmrc`); `DUST_SYNC` unset, so Dust uses the shipped event-based sync.
