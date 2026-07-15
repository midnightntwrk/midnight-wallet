# @midnightntwrk/wallet-sdk-testkit

## 0.2.0

### Minor Changes

- 3c1dfa0: Add `@midnightntwrk/wallet-sdk-testkit`, a publishable package that extracts the reusable wallet e2e harness
  (environment provisioning, wallet bootstrapping, sync waiters, tx-history assertions) so downstream consumers can
  share it instead of vendoring copies. Endpoints are injected via a `WalletTestEnvironment` config
  (`createRemoteEnvironment` / `createTestContainersEnvironment`) rather than read from `process.env`. Shared
  healthcheck scenarios are single-sourced via `registerDustHealthchecks` and `registerTokenTransferHealthchecks`.

### Patch Changes

- Updated dependencies [dff5706]
- Updated dependencies [54a9c4d]
- Updated dependencies [417d042]
- Updated dependencies [e0097fc]
  - @midnightntwrk/wallet-sdk-dust-wallet@4.2.0
  - @midnightntwrk/wallet-sdk-facade@4.1.0
  - @midnightntwrk/wallet-sdk-shielded@3.0.2
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.3
  - @midnightntwrk/wallet-sdk-hd@3.0.3
