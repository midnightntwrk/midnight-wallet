# @midnightntwrk/wallet-sdk-runtime

## 1.0.6

### Patch Changes

- 1eaad77: Pin internal `@midnightntwrk/wallet-sdk-*` dependencies to exact versions instead of caret ranges. A caret
  range on a prerelease base (e.g. `^5.0.0-beta.0`) satisfies canary snapshots published on the same `major.minor.patch`
  (`5.0.0-canary.*`), and since `canary` sorts above `beta`/`alpha`, installing a prerelease pulled canary builds of the
  sibling packages. Exact pins make published releases resolve to a single coherent set regardless of what snapshots
  exist on the registry.
- Updated dependencies [e89ab0b]
  - @midnightntwrk/wallet-sdk-abstractions@3.0.0

## 1.0.5

### Patch Changes

- 0b41e11: Replace the shared unbounded-with-replay runtime state-changes stream with per-subscriber
  `SubscriptionRef.changes` decoupled by a sliding buffer of capacity 1. The previous configuration kept references to
  past state instances alive, preventing them from being released: Effect's PubSub replay buffer appends every published
  value to a shared linked list and a subscription's replay window never releases its head node, so any long-lived
  subscriber pinned every state published during its lifetime (and the wasm resources those states hold).

  The stream now has latest-value semantics: every subscriber receives the current state on subscription and always
  converges on the latest state, but may skip intermediate states when it lags behind the producer. Memory is bounded to
  the current state plus at most one buffered state per subscriber.

## 1.0.4

### Patch Changes

- 25f58b4: Widen ranges for internal `@midnightntwrk/wallet-sdk-*` dependencies from exact versions to caret ranges so
  consumers can dedupe shared sibling packages into a single installed copy.
- Updated dependencies [6e187fe]
- Updated dependencies [7452e96]
  - @midnightntwrk/wallet-sdk-utilities@1.2.0

## 1.0.3

### Patch Changes

- 7f82432: Introduce a shared transaction history storage layer with support for wallet-specific augmentation.
  Reimplement shielded wallet transaction history and refactor unshielded wallet transaction history to use the new
  shared storage.
- Updated dependencies [c1ae369]
- Updated dependencies [0db3290]
- Updated dependencies [7f82432]
  - @midnightntwrk/wallet-sdk-abstractions@2.1.0
  - @midnightntwrk/wallet-sdk-utilities@1.1.1

## 1.0.2

### Patch Changes

- Updated dependencies [ea55591]
- Updated dependencies [aa7b1f4]
  - @midnightntwrk/wallet-sdk-utilities@1.1.0

## 1.0.2-rc.0

### Patch Changes

- Updated dependencies [ea55591]
- Updated dependencies [aa7b1f4]
  - @midnightntwrk/wallet-sdk-utilities@1.1.0-rc.0

## 1.0.1

### Patch Changes

- Updated dependencies [3843720]
- Updated dependencies [0f29d01]
- Updated dependencies [55380e5]
- Updated dependencies [330867f]
  - @midnightntwrk/wallet-sdk-abstractions@2.0.0
  - @midnightntwrk/wallet-sdk-utilities@1.0.1

## 1.0.1-rc.2

### Patch Changes

- Updated dependencies [55380e5]
  - @midnightntwrk/wallet-sdk-utilities@1.0.1-rc.1

## 1.0.1-rc.1

### Patch Changes

- Updated dependencies [0f29d01]
  - @midnightntwrk/wallet-sdk-abstractions@2.0.0-rc.1

## 1.0.1-rc.0

### Patch Changes

- Updated dependencies [3843720]
- Updated dependencies [330867f]
  - @midnightntwrk/wallet-sdk-abstractions@2.0.0-rc.0
  - @midnightntwrk/wallet-sdk-utilities@1.0.1-rc.0

## 1.0.0

### Patch Changes

- fb55d52: chore: initialize baseline release after introducing Changesets
- fb55d52: chore: force re-release after workspace failure
- bcef7d8: Allow TX creation with no own outputs
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

## 1.0.0-beta.12

### Patch Changes

- Updated dependencies [f7aac06]
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.11

## 1.0.0-beta.11

### Patch Changes

- Updated dependencies [8b8d708]
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.10

## 1.0.0-beta.10

### Patch Changes

- bcef7d8: Allow TX creation with no own outputs
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.9
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.10

## 1.0.0-beta.9

### Patch Changes

- Updated dependencies [aef8d4b]
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.8

## 1.0.0-beta.8

### Patch Changes

- Updated dependencies [a06ccf3]
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.9

## 1.0.0-beta.7

### Patch Changes

- Updated dependencies [976628a]
- Updated dependencies [1db4280]
- Updated dependencies [646c8df]
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.7
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.8

## 1.0.0-beta.6

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure
- Updated dependencies [2a0d132]
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.7
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.6

## 1.0.0-beta.5

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
- Updated dependencies [ae22baf]
  - @midnightntwrk/wallet-sdk-abstractions@1.0.0-beta.6
  - @midnightntwrk/wallet-sdk-utilities@1.0.0-beta.5
