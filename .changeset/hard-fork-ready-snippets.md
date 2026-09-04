---
---

Make the documentation snippets hard-fork ready. Every snippet now imports only from `@midnightntwrk/wallet-sdk` and
its subpaths; every wallet is configured to run on ledger-v8 below `forks.v9` and on ledger-v9 from it — proving
included, with a proof server per ledger version under `provers` (the in-process prover needs one entry, since the
same backend serves both); the examples that author their own transactions pick the ledger — `./ledger/v8` below
`forks.v9`, `./ledger/v9` from it — by the protocol version the wallets are acting at and seal the handle with that
version, so they run on a pre-fork chain and follow it across the fork instead of stamping version 0, which a wallet
past the fork refuses; and the projections fast-sync example is composed either side of the boundary — ledger-v8 event
replay below it, projections from it — with `withStartAuxDefaults()` restated after `withSync`, which drops it, so a
start from a seed works again. Documentation and tests only — no API changes.
