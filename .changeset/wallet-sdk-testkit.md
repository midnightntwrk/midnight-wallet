---
"@midnightntwrk/wallet-sdk-testkit": minor
---

Add `@midnightntwrk/wallet-sdk-testkit`, a publishable package that extracts the reusable wallet e2e harness (environment provisioning, wallet bootstrapping, sync waiters, tx-history assertions) so downstream consumers can share it instead of vendoring copies. Endpoints are injected via a `WalletTestEnvironment` config (`createRemoteEnvironment` / `createTestContainersEnvironment`) rather than read from `process.env`. Shared healthcheck scenarios are single-sourced via `registerDustHealthchecks` and `registerTokenTransferHealthchecks`.
