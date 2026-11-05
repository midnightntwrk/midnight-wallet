---
'@midnightntwrk/wallet-sdk-node-client': major
---

Breaking changes since 1.x

- `NodeClient.Service` requires `getFinalizedBlock()`, `getGenesisHash()` and `getBlockHashAt(height)`, which returns
  `Option.none` for a height with no block. Only implementers of the service are affected; the module also exports them
  as functions, with the `NodeClient.FinalizedBlock` type.
- The optional peer dependencies of `./testing` are `@midnightntwrk/ledger-v9` `^1.0.0`, instead of
  `@midnight-ntwrk/ledger-v8`, and `@midnightntwrk/wallet-sdk-prover-client` 2.x (was `^1.2.3`); the transactions it
  produces are ledger-v9's.
- The `PolkadotNodeClient` constructor takes a third argument; build clients with `make` or `layer`.
