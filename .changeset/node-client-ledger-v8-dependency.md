---
'@midnight-ntwrk/wallet-sdk-node-client': patch
---

Declare `@midnight-ntwrk/ledger-v8` and `@midnight-ntwrk/wallet-sdk-prover-client` as optional peer
dependencies. They are used at runtime by the `./testing` export, so consumers of that export need
them installed.
