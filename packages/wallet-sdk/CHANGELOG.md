# @midnight-ntwrk/wallet-sdk

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

- Updated dependencies [8004393]
  - @midnight-ntwrk/wallet-sdk-facade@4.0.1

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
  - @midnight-ntwrk/wallet-sdk-capabilities@3.3.0
  - @midnight-ntwrk/wallet-sdk-facade@4.0.0
  - @midnight-ntwrk/wallet-sdk-dust-wallet@4.0.0
  - @midnight-ntwrk/wallet-sdk-shielded@3.0.0
  - @midnight-ntwrk/wallet-sdk-unshielded-wallet@3.0.0
  - @midnight-ntwrk/wallet-sdk-abstractions@2.1.0
  - @midnight-ntwrk/wallet-sdk-address-format@3.1.1
  - @midnight-ntwrk/wallet-sdk-utilities@1.1.1
  - @midnight-ntwrk/wallet-sdk-hd@3.0.2
