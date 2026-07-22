# @midnightntwrk/wallet-sdk-testkit

## 0.2.1

### Patch Changes

- 1b0bfb2: fix(testkit): correct state-waiters that no longer waited for the intended condition

  Several `state-waiters` helpers resolved prematurely (or hung) after `submitTransaction` began recording an optimistic
  _pending_ tx-history entry on submit (facade #365):

  - `waitForTxInHistory` treated any entry whose top-level `status` was not exactly `'SUCCESS'` as terminal, so it
    aborted on the freshly-inserted pending entry (`status` undefined) and asserted
    `expected undefined to be 'SUCCESS'`. It now only aborts on a genuinely terminal outcome
    (`lifecycle.status === 'rejected'`, or `status` `'FAILURE'`/`'PARTIAL_SUCCESS'`) and keeps waiting while the tx is
    still pending. This unblocks the token-transfer `@healthcheck` (and the downstream sentinel monitoring that consumes
    it).
  - `waitForStateAfterDustRegistration` treated "tx present in history" as "tx confirmed", which is now true the instant
    a tx is submitted. It now requires the entry's `status === 'SUCCESS'`.
  - `waitForFinalizedShieldedBalance` resolved on the resting pre-transaction state (`pendingCoins.length === 0` is also
    the idle condition). It now debounces until the state settles before checking.
  - `waitForFacadePending` could hang until the whole-test timeout if the pending window was missed. It now fails fast
    (2 min) with a descriptive error.

- 853dc3e: Fix uninstallable `wallet-sdk-testkit@0.2.0`. That release shipped its internal `wallet-sdk-*` dependencies
  (and the `wallet-sdk-utilities` peer) as the monorepo-only `workspace:^` specifier, which leaked into the published
  tarball on both the `@midnightntwrk` and `@midnight-ntwrk` scopes. External installs failed (`npm` →
  `EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`, `yarn` classic → "Couldn't find any versions ... that
  matches workspace:^"). This release publishes those dependencies with concrete versions, restoring installability.
- 1eaad77: Pin internal `@midnightntwrk/wallet-sdk-*` dependencies to exact versions instead of caret ranges. A caret
  range on a prerelease base (e.g. `^5.0.0-beta.0`) satisfies canary snapshots published on the same `major.minor.patch`
  (`5.0.0-canary.*`), and since `canary` sorts above `beta`/`alpha`, installing a prerelease pulled canary builds of the
  sibling packages. Exact pins make published releases resolve to a single coherent set regardless of what snapshots
  exist on the registry.
- Updated dependencies [b545c3b]
- Updated dependencies [44bbcae]
- Updated dependencies [ef16433]
- Updated dependencies [44bbcae]
- Updated dependencies [ead236e]
- Updated dependencies [e89ab0b]
- Updated dependencies [1eaad77]
- Updated dependencies [ef16433]
  - @midnightntwrk/wallet-sdk-indexer-client@2.0.0
  - @midnightntwrk/wallet-sdk-dust-wallet@5.0.0
  - @midnightntwrk/wallet-sdk-facade@5.0.0
  - @midnightntwrk/wallet-sdk-shielded@3.1.0
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0
  - @midnightntwrk/wallet-sdk-unshielded-wallet@3.2.0
  - @midnightntwrk/wallet-sdk-capabilities@3.4.0

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
