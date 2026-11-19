---
'@midnightntwrk/wallet-sdk-shielded': patch
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(shielded-wallet,dust-wallet): retry indexer server errors when looking up a transaction's history details

The shielded and Dust wallets look up each applied change's transaction on the indexer before writing its history
entry. That lookup now retries a server error (indexer down, unreachable or 5xx) within `transactionDetailsRetryWindow`,
as it already did for a transaction the indexer has not yet ingested, so a short indexer outage no longer drops the
entry on the first failed lookup. A client error (4xx or GraphQL error) still fails at once.
