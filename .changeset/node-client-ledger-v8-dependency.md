---
'@midnight-ntwrk/wallet-sdk-node-client': patch
---

Move `@midnight-ntwrk/ledger-v8` from `devDependencies` to `dependencies`. It is used at runtime
by the `./testing` export, so consumers need it resolved as a regular dependency.
