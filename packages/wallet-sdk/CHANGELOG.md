# @midnightntwrk/wallet-sdk

## 1.2.1

### Patch Changes

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
  - @midnightntwrk/wallet-sdk-node-client@1.1.4
  - @midnightntwrk/wallet-sdk-prover-client@1.2.4
  - @midnightntwrk/wallet-sdk-runtime@1.0.6

## 1.2.0

### Minor Changes

- a4e049d: Republish the barrel package to track the latest sibling versions shipped in this release (facade,
  dust-wallet, shielded, indexer-client, prover-client, node-client, runtime, hd, and the new testkit). No API changes
  to the barrel itself — the version bump keeps the `@midnightntwrk/wallet-sdk` release line aligned with the underlying
  packages it re-exports.

### Patch Changes

- Updated dependencies [dff5706]
- Updated dependencies [7111b55]
- Updated dependencies [54a9c4d]
- Updated dependencies [417d042]
- Updated dependencies [e0097fc]
- Updated dependencies [81ae094]
- Updated dependencies [0b41e11]
  - @midnightntwrk/wallet-sdk-dust-wallet@4.2.0
  - @midnightntwrk/wallet-sdk-facade@4.1.0
  - @midnightntwrk/wallet-sdk-prover-client@1.2.3
  - @midnightntwrk/wallet-sdk-shielded@3.0.2
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.3
  - @midnightntwrk/wallet-sdk-hd@3.0.3
  - @midnightntwrk/wallet-sdk-node-client@1.1.3
  - @midnightntwrk/wallet-sdk-runtime@1.0.5

## 1.1.0

### Minor Changes

- db8db9c: Barrel-export every non-ignored wallet-sdk package. Adds `indexer-client`, `node-client`, `prover-client`,
  `runtime`, and `utilities` as new subpath entry points (each matching their package folder name), and surfaces every
  nested subpath those packages already expose (`/v1`, `/effect`, `/abstractions`, `/balancer`, `/pendingTransactions`,
  `/proving`, `/simulation`, `/submission`, `/networking`, `/types`, `/testing`). The main entry point now also
  re-exports `prover-client` and `utilities` flat, plus namespaced `Capabilities`, `IndexerClient`, `NodeClient`, and
  `Runtime` (namespaced to avoid name collisions with other packages). Legacy `/proving` and `/testing` aliases remain
  for backwards compatibility.

### Patch Changes

- Updated dependencies [0fd0062]
- Updated dependencies [6e187fe]
- Updated dependencies [8004393]
- Updated dependencies [7452e96]
- Updated dependencies [25f58b4]
  - @midnightntwrk/wallet-sdk-dust-wallet@4.1.0
  - @midnightntwrk/wallet-sdk-unshielded-wallet@3.1.0
  - @midnightntwrk/wallet-sdk-utilities@1.2.0
  - @midnightntwrk/wallet-sdk-facade@4.0.1
  - @midnightntwrk/wallet-sdk-address-format@3.1.2
  - @midnightntwrk/wallet-sdk-capabilities@3.3.1
  - @midnightntwrk/wallet-sdk-node-client@1.1.2
  - @midnightntwrk/wallet-sdk-prover-client@1.2.2
  - @midnightntwrk/wallet-sdk-shielded@3.0.1
  - @midnightntwrk/wallet-sdk-indexer-client@1.2.2
  - @midnightntwrk/wallet-sdk-runtime@1.0.4

## 1.0.0

### Major Changes

- 471583c: First release of wallet-sdk barrel package

### Minor Changes

- 93492c0: Add a proper barrel package to the wallet sdk

### Patch Changes

- Updated dependencies [e57a94b]
- Updated dependencies [c1ae369]
- Updated dependencies [55715af]
- Updated dependencies [eba8e08]
- Updated dependencies [6e67871]
- Updated dependencies [3763803]
- Updated dependencies [8383f7b]
- Updated dependencies [1f794fa]
- Updated dependencies [0db3290]
- Updated dependencies [0529e6a]
- Updated dependencies [7f82432]
- Updated dependencies [aaa0bf1]
  - @midnightntwrk/wallet-sdk-capabilities@3.3.0
  - @midnightntwrk/wallet-sdk-facade@4.0.0
  - @midnightntwrk/wallet-sdk-dust-wallet@4.0.0
  - @midnightntwrk/wallet-sdk-shielded@3.0.0
  - @midnightntwrk/wallet-sdk-unshielded-wallet@3.0.0
  - @midnightntwrk/wallet-sdk-abstractions@2.1.0
  - @midnightntwrk/wallet-sdk-address-format@3.1.1
  - @midnightntwrk/wallet-sdk-utilities@1.1.1
  - @midnightntwrk/wallet-sdk-hd@3.0.2
