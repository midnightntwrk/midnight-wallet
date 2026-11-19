---
'@midnightntwrk/wallet-sdk-shielded': patch
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(shielded-wallet,dust-wallet): retry indexer server errors when looking up a transaction's history details

The shielded and Dust wallets look up each applied change's transaction on the indexer before writing its history
entry. That lookup now retries a server error (indexer down, unreachable or 5xx) within `transactionDetailsRetryWindow`,
as it already did for a transaction the indexer has not yet ingested, so a short indexer outage no longer drops the
entry on the first failed lookup. A lookup still failing when the window runs out is tried again about once a minute
for as long as the wallet runs. A client error (4xx or GraphQL error) fails at once with the new
`TransactionDetailsRejectedError` and is not tried again, since waiting cannot turn it into an answer;
`getTransactionDetails` reported it as a `TransactionHistoryError` before.
