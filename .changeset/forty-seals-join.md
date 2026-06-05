---
'@midnight-ntwrk/wallet-sdk-abstractions': major
'@midnight-ntwrk/wallet-sdk-facade': major
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': minor
'@midnight-ntwrk/wallet-sdk-shielded': minor
'@midnight-ntwrk/wallet-sdk-dust-wallet': minor
'@midnight-ntwrk/wallet-sdk-indexer-client': minor
---

Track transaction lifecycle in transaction history. Submitted transactions are now recorded as pending, transition to finalized once confirmed by the indexer, and to rejected if they are reverted — giving a single, consistent view of in-flight and settled transactions.
