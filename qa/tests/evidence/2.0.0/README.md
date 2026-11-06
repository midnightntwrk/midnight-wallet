# Wallet SDK QA Test Execution and Report Summary — 2.0.0

## Overview

| Field                | Value                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Date                 | 6 November 2026                                                                                    |
| QA Contact           | Joe Tsang (joe.tsang@shielded.io)                                                                  |
| wallet-sdk version   | 2.0.0, the published npm packages (gitHead `c553042c`)                                             |
| Ledger               | `@midnightntwrk/ledger-v8` 8.1.3, `@midnightntwrk/ledger-v9` 1.0.0, `@midnightntwrk/zkir-v2` 2.2.0 |
| Node version         | 2.1.0-rc.4                                                                                         |
| Indexer version      | 4.4.0-rc.6                                                                                         |
| Proof server version | 9.0.0                                                                                              |
| QA Sign-off          | ✅ no test failures; one suite's containers did not start, and it passed when re-run               |

## Test Execution Summary

```
┌─────────────┬───────┬────────┬────────┬─────────┬───────┐
│ Environment │ Suite │ Passed │ Failed │ Skipped │ Total │
├─────────────┼───────┼────────┼────────┼─────────┼───────┤
│ undeployed  │ e2e   │    103 │      0 │       7 │   110 │
└─────────────┴───────┴────────┴────────┴─────────┴───────┘
```

One run of the full undeployed lane (17 files, run in parallel), 451 s, with the suite's own `retry: 1`. Raw results:
[undeployed/e2e/junit-test-results.xml](undeployed/e2e/junit-test-results.xml).

6 of the skips are static `.skip`s in the test source. The 7th is `multipleWallets` › "Syncing is working for multiple
wallets concurrently": its suite setup failed with `Port 6300/tcp not bound after 60000ms` while 17 container stacks
were starting at once, so the test never ran. JUnit records that setup error as a failed `Syncing` entry, which is why
the XML counts 111 entries with 1 failure. Re-run alone on the same build, the test passed (1/1).

## Test Execution Guide

From the repository root at gitHead `c553042c`, with `packages/e2e-tests` resolving the published 2.0.0 packages rather
than the workspace, and the infra secrets from the e2e README:

```bash
export NETWORK=undeployed
export SYNC_CACHE=<empty directory>
export APP_INFRA_SECRET=...   # and the APP_INFRA_*_PASSWORD variables
cd packages/e2e-tests && yarn test-undeployed
```

Node 24 (`.nvmrc`); `DUST_SYNC` unset, so Dust uses the shipped event-based sync.
