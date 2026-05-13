---
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
'@midnight-ntwrk/wallet-sdk-facade': patch
'@midnight-ntwrk/wallet-sdk-indexer-client': patch
'@midnight-ntwrk/wallet-sdk-node-client': patch
'@midnight-ntwrk/wallet-sdk-prover-client': patch
'@midnight-ntwrk/wallet-sdk-runtime': patch
'@midnight-ntwrk/wallet-sdk-shielded': patch
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
---

Widen ranges for internal `@midnight-ntwrk/wallet-sdk-*` dependencies from exact versions to caret ranges so consumers can dedupe shared sibling packages into a single installed copy.
