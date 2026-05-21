---
'@midnight-ntwrk/wallet-sdk-address-format': patch
'@midnight-ntwrk/wallet-sdk-capabilities': patch
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
'@midnight-ntwrk/wallet-sdk-facade': patch
'@midnight-ntwrk/wallet-sdk-node-client': patch
'@midnight-ntwrk/wallet-sdk-prover-client': patch
'@midnight-ntwrk/wallet-sdk-shielded': patch
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
'@midnight-ntwrk/wallet-sdk-utilities': patch
---

Bump `@midnight-ntwrk/ledger-v8` from `^8.0.3` to `^8.1.0`. Internal balancing flows in `dust-wallet`, `unshielded-wallet`, and `shielded-wallet` are refactored to use the new ledger 8.1.0 builder API (`Transaction.addIntent`, `Transaction.addZswapOffer`) instead of post-construction field mutation on `Transaction.fromParts(...)`. No public API changes; consumers must resolve `@midnight-ntwrk/ledger-v8` to `>=8.1.0`.
