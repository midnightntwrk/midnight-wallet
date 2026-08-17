---
'@midnightntwrk/wallet-sdk-abstractions': major
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-indexer-client': minor
---

Track transaction lifecycle in transaction history. Submitted transactions are now recorded as pending, transition to finalized once confirmed by the indexer, and to rejected if they are reverted — giving a single, consistent view of in-flight and settled transactions.
