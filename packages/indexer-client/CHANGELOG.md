# @midnightntwrk/wallet-sdk-indexer-client

## 1.2.4-beta.0

### Patch Changes

- 44bbcae: Remove unused devDependencies `@graphql-codegen/typescript` and `@graphql-codegen/typescript-operations`.
  They are bundled transitively by `@graphql-codegen/client-preset` (used via `preset: 'client'` in `codegen.ts`), so
  dropping them as direct dependencies has no effect on code generation or the published package.

## 1.2.3

### Patch Changes

- 417d042: Fix a fiber/memory leak in the WebSocket subscription stream. At the indexer's sustained ~1k msg/sec push
  rate, `Stream.async` was forking a top-level fiber per emit (via `Runtime.runPromiseExit`) and accumulating them in
  Effect's `Global.roots`. Switched to `Stream.asyncPush`, which writes straight to an internal queue and ties teardown
  to the surrounding scope via `Effect.acquireRelease`. Also preserves the full GraphQL error array as `cause` on
  `ClientError` and joins all error messages instead of dropping all but the first.

## 1.2.2

### Patch Changes

- 25f58b4: Widen ranges for internal `@midnightntwrk/wallet-sdk-*` dependencies from exact versions to caret ranges so
  consumers can dedupe shared sibling packages into a single installed copy.
- Updated dependencies [6e187fe]
- Updated dependencies [7452e96]
  - @midnightntwrk/wallet-sdk-utilities@1.2.0

## 1.2.1

### Patch Changes

- e57a94b: Unify Simulator into capabilities package with proper fee payment and block production model
- 7f82432: Introduce a shared transaction history storage layer with support for wallet-specific augmentation.
  Reimplement shielded wallet transaction history and refactor unshielded wallet transaction history to use the new
  shared storage.
- Updated dependencies [0db3290]
- Updated dependencies [7f82432]
  - @midnightntwrk/wallet-sdk-utilities@1.1.1

## 1.2.0

### Minor Changes

- aa7b1f4: chore: update ledger to v8

### Patch Changes

- 9d71d25: feat: expose Terms and Conditions via `WalletFacade.fetchTermsAndConditions`

  Adds a new `FetchTermsAndConditions` GraphQL query to `@midnightntwrk/wallet-sdk-indexer-client` that retrieves the
  current Terms and Conditions (URL and SHA-256 hash) from the network indexer.

  Exposes a new static method `WalletFacade.fetchTermsAndConditions(configuration)` in
  `@midnightntwrk/wallet-sdk-facade` that wallet builders can call before or independently of wallet initialization to
  obtain the T&C URL for display and the hash for content verification. The method accepts any configuration that
  includes `indexerClientConnection.indexerHttpUrl`, so the shared wallet configuration can be passed directly without
  adaptation.

- Updated dependencies [ea55591]
- Updated dependencies [aa7b1f4]
  - @midnightntwrk/wallet-sdk-utilities@1.1.0

## 1.2.0-rc.0

### Minor Changes

- aa7b1f4: chore: update ledger to v8

### Patch Changes

- 9d71d25: feat: expose Terms and Conditions via `WalletFacade.fetchTermsAndConditions`

  Adds a new `FetchTermsAndConditions` GraphQL query to `@midnightntwrk/wallet-sdk-indexer-client` that retrieves the
  current Terms and Conditions (URL and SHA-256 hash) from the network indexer.

  Exposes a new static method `WalletFacade.fetchTermsAndConditions(configuration)` in
  `@midnightntwrk/wallet-sdk-facade` that wallet builders can call before or independently of wallet initialization to
  obtain the T&C URL for display and the hash for content verification. The method accepts any configuration that
  includes `indexerClientConnection.indexerHttpUrl`, so the shared wallet configuration can be passed directly without
  adaptation.

- Updated dependencies [ea55591]
- Updated dependencies [aa7b1f4]
  - @midnightntwrk/wallet-sdk-utilities@1.1.0-rc.0

## 1.1.0

### Minor Changes

- f52d01d: - Create a pending transactions service in the `@midnightntwrk/wallet-sdk-capabilities` package. The service
  checks TTL and status of transactions against indexer in order to report failures. The service state is also meant to
  be serialized and restored in order to not loose track of pending transactions in case of wallet restarts
  - Integrate the pending transactions service into the `WalletFacade`. It registers transactions as soon as they are
    finalized (it can't happen earlier because unproven transactions contain copies of secret keys for proving
    purposes). Whenever a pending transaction is reported as failed - it is reverted. The pending transactions service
    state is also reported in the facade state for serialization purposes and to enable UI reporting.

### Patch Changes

- 6c359b8: Expose promise-based QueryRunner utility for executing GraphQL queries without Effect boilerplate
- dd004db: Add optional `keepAlive` config param to `SubscriptionClient.ServerConfig` and to `IndexerClientConnection`
  in all wallet packages. The value is forwarded to the underlying `graphql-ws` client and defaults to `15_000` ms when
  not provided.
- Updated dependencies [55380e5]
- Updated dependencies [330867f]
  - @midnightntwrk/wallet-sdk-utilities@1.0.1

## 1.1.0-rc.4

### Patch Changes

- dd004db: Add optional `keepAlive` config param to `SubscriptionClient.ServerConfig` and to `IndexerClientConnection`
  in all wallet packages. The value is forwarded to the underlying `graphql-ws` client and defaults to `15_000` ms when
  not provided.

## 1.1.0-rc.3

### Patch Changes

- Updated dependencies [55380e5]
  - @midnightntwrk/wallet-sdk-utilities@1.0.1-rc.1

## 1.1.0-rc.2

### Patch Changes

- Updated dependencies [0f29d01]
  - @midnightntwrk/wallet-sdk-abstractions@2.0.0-rc.1

## 1.1.0-rc.1

### Patch Changes

- Updated dependencies [3843720]
- Updated dependencies [330867f]
  - @midnightntwrk/wallet-sdk-abstractions@2.0.0-rc.0
  - @midnightntwrk/wallet-sdk-utilities@1.0.1-rc.0

## 1.1.0-rc.0

### Minor Changes

- f52d01d: - Create a pending transactions service in the `@midnightntwrk/wallet-sdk-capabilities` package. The service
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
  - @midnightntwrk/wallet-sdk-utilities@1.0.0
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0

## 1.0.0-beta.17

### Patch Changes

- Updated dependencies [f7aac06]
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.11

## 1.0.0-beta.16

### Patch Changes

- Updated dependencies [8b8d708]
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.10

## 1.0.0-beta.15

### Patch Changes

- 94a39ef: Adjust WebSocket client configuration to prevent unnecessary reconnections and data requests
- bcef7d8: Allow TX creation with no own outputs
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.9
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.10

## 1.0.0-beta.14

### Patch Changes

- Updated dependencies [aef8d4b]
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.8

## 1.0.0-beta.13

### Patch Changes

- b9865cf: feat: rewrite unshielded wallet runtime

## 1.0.0-beta.12

### Patch Changes

- Updated dependencies [a06ccf3]
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.9

## 1.0.0-beta.11

### Patch Changes

- 1db4280: chore: bump ledger to version 6.1.0-beta.5
- Updated dependencies [976628a]
- Updated dependencies [1db4280]
- Updated dependencies [646c8df]
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.7
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.8

## 1.0.0-beta.10

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure
- Updated dependencies [2a0d132]
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.7
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.6

## 1.0.0-beta.9

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
- Updated dependencies [ae22baf]
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.6
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.5
