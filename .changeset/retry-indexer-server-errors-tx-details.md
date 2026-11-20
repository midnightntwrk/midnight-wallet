---
'@midnightntwrk/wallet-sdk-shielded': patch
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(shielded-wallet,dust-wallet): retry indexer server errors when looking up a transaction's history details

A lookup now retries while the indexer is down or failing, instead of dropping the entry. A client error (4xx or
GraphQL) still fails at once, now marked `retryable: false` on `TransactionHistoryError`.
