---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
'@midnight-ntwrk/wallet-sdk-shielded': major
'@midnight-ntwrk/wallet-sdk-address-format': patch
'@midnight-ntwrk/wallet-sdk-indexer-client': patch
'@midnight-ntwrk/wallet-sdk-prover-client': patch
'@midnight-ntwrk/wallet-sdk-abstractions': patch
'@midnight-ntwrk/wallet-sdk-capabilities': patch
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
'@midnight-ntwrk/wallet-sdk-node-client': patch
'@midnight-ntwrk/wallet-sdk-utilities': patch
'@midnight-ntwrk/wallet-sdk-runtime': patch
'@midnight-ntwrk/wallet-sdk-facade': patch
'@midnight-ntwrk/wallet-sdk-hd': patch
---

Introduce a shared transaction history storage layer with support for wallet-specific augmentation. Reimplement shielded wallet transaction history and refactor unshielded wallet transaction history to use the new shared storage.
