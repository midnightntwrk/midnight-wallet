# @midnight-ntwrk/wallet-sdk-dust-wallet

## 1.0.0-beta.14

### Patch Changes

- 8b8d708: chore: update ledger to version 7.0.0-rc.1
- Updated dependencies [8b8d708]
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.15
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.13
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0-beta.12
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.16

## 1.0.0-beta.13

### Patch Changes

- dae514d: chore: update ledger to 7.0.0-alpha.1
- bcef7d8: Allow TX creation with no own outputs
- Updated dependencies [94a39ef]
- Updated dependencies [dae514d]
- Updated dependencies [bcef7d8]
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.15
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.14
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.12
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.8

## 1.0.0-beta.12

### Patch Changes

- aef8d4b: Performance improvement: Shielded and Dust wallet now send events in batches of 50 or after 10 seconds if
  total events has not reached 50
- Updated dependencies [aef8d4b]
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.13
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.14

## 1.0.0-beta.11

### Patch Changes

- Updated dependencies [b9865cf]
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.13
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.12

## 1.0.0-beta.10

### Patch Changes

- 3f14055: chore: bump ledger to version 6.1.0-alpha.6
- Updated dependencies [3f14055]
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0-beta.10

## 1.0.0-beta.9

### Patch Changes

- fb55d52: Introduce more convenient API for Bech32m address encoding/decoding Remove network id from Dust wallet
  initialization methods (so they are read from the configuration) Introduce FacadeState and add a getter to check for
  sync status of whole facade wallet Introduce CompositeDerivation for HD wallet, so that it is possible to derive keys
  for multiple roles at once
- Updated dependencies [fb55d52]
- Updated dependencies [a06ccf3]
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.12
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.9

## 1.0.0-beta.8

### Patch Changes

- f967d17: chore: remove wallet api dep from dust wallet
- 1db4280: chore: bump ledger to version 6.1.0-beta.5
- Updated dependencies [976628a]
- Updated dependencies [0838f04]
- Updated dependencies [f6618f1]
- Updated dependencies [1db4280]
- Updated dependencies [646c8df]
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.11
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0-beta.9

## 1.0.0-beta.7

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure
- Updated dependencies [2a0d132]
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.10
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.8
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.6

## 1.0.0-beta.6

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
- Updated dependencies [ae22baf]
  - @midnight-ntwrk/wallet-sdk-abstractions@1.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-address-format@3.0.0-beta.5
  - @midnight-ntwrk/wallet-sdk-capabilities@3.0.0-beta.5
  - @midnight-ntwrk/wallet-sdk-hd@3.0.0-beta.5
  - @midnight-ntwrk/wallet-sdk-indexer-client@1.0.0-beta.9
  - @midnight-ntwrk/wallet-sdk-node-client@1.0.0-beta.7
  - @midnight-ntwrk/wallet-sdk-prover-client@1.0.0-beta.6
  - @midnight-ntwrk/wallet-sdk-utilities@1.0.0-beta.5
  - @midnight-ntwrk/wallet-sdk-shielded@1.0.0-beta.7
