---
---

Make the documentation snippets hard-fork ready. Every snippet now imports only from `@midnightntwrk/wallet-sdk` and
its subpaths (the fork constant from the root, the ledger from `./ledger/v9`); the examples that author their own
transactions seal them with the protocol version the wallets are acting at instead of version 0, which a wallet on a
chain past the fork refuses; the in-process prover example registers its WASM prover from `forkVersion`, the way a proof
server is registered under `provingServers`; and the projections fast-sync example restates `withStartAuxDefaults()`
after `withSync`, which drops it, so a start from a seed works again. Documentation and tests only — no API changes.
