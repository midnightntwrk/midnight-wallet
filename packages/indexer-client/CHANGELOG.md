# @midnight-ntwrk/wallet-sdk-indexer-client

## 1.1.0-rc.0

### Minor Changes

- f52d01d: - Create a pending transactions service in the `@midnight-ntwrk/wallet-sdk-capabilities` package. The service
  checks TTL and status of transactions against indexer in order to report failures. The service state is also meant to
  be serialized and restored in order to not loose track of pending transactions in case of wallet restarts
  - Integrate the pending transactions service into the `WalletFacade`. It registers transactions as soon as they are
    finalized (it can't happen earlier because unproven transactions contain copies of secret keys for proving
    purposes). Whenever a pending transaction is reported as failed - it is reverted. The pending transactions service
    state is also reported in the facade state for serialization purposes and to enable UI reporting.

## 1.0.0

### Patch Changes

- 94a39ef: Adjust WebSocket client configuration to prevent unnecessary reconnections and data requests
- fb55d52: chore: initialize baseline release after introducing Changesets
- fb55d52: chore: force re-release after workspace failure
- bcef7d8: Allow TX creation with no own outputs
- fb55d52: chore: bump ledger to version 6.1.0-beta.5
- b9865cf: feat: rewrite unshielded wallet runtime
- Updated dependencies [fb55d52]
- Updated dependencies [f7aac06]
- Updated dependencies [a06ccf3]
- Updated dependencies [aef8d4b]
- Updated dependencies [8b8d708]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
- Updated dependencies [fb55d52]
- Updated dependencies [fb55d52]
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0

## 1.0.0-beta.17

### Patch Changes

- Updated dependencies [f7aac06]
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.11

## 1.0.0-beta.16

### Patch Changes

- Updated dependencies [8b8d708]
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.10

## 1.0.0-beta.15

### Patch Changes

- 94a39ef: Adjust WebSocket client configuration to prevent unnecessary reconnections and data requests
- bcef7d8: Allow TX creation with no own outputs
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.10

## 1.0.0-beta.14

### Patch Changes

- Updated dependencies [aef8d4b]
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.8

## 1.0.0-beta.13

### Patch Changes

- b9865cf: feat: rewrite unshielded wallet runtime

## 1.0.0-beta.12

### Patch Changes

- Updated dependencies [a06ccf3]
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.9

## 1.0.0-beta.11

### Patch Changes

- 1db4280: chore: bump ledger to version 6.1.0-beta.5
- Updated dependencies [976628a]
- Updated dependencies [1db4280]
- Updated dependencies [646c8df]
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.8

## 1.0.0-beta.10

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure
- Updated dependencies [2a0d132]
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.6

## 1.0.0-beta.9

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
- Updated dependencies [ae22baf]
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.5
