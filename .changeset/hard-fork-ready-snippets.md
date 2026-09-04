---
---

Make the documentation snippets hard-fork ready. Every snippet now imports only from `@midnightntwrk/wallet-sdk` and
its subpaths; the examples that author their own transactions pick the ledger — `./ledger/v8` below `forkVersion`,
`./ledger/v9` from it — by the protocol version the wallets are acting at and seal the handle with that version, so they
run on a pre-fork chain and follow it across the fork instead of stamping version 0, which a wallet past the fork
refuses; the in-process prover example registers its WASM prover from `forkVersion`, the way a proof server is
registered under `provingServers`; and the projections fast-sync example restates `withStartAuxDefaults()` after
`withSync`, which drops it, so a start from a seed works again. Documentation and tests only — no API changes.
