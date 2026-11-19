---
'@midnightntwrk/wallet-sdk-shielded': patch
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(shielded-wallet,dust-wallet): retry indexer server errors when looking up a transaction's history details

The shielded and Dust wallets look up each applied change's transaction on the indexer before writing its history
entry. That lookup now retries a server error (indexer down, unreachable or 5xx) within `transactionDetailsRetryWindow`,
as it already did for a transaction the indexer has not yet ingested, so a short indexer outage no longer drops the
entry on the first failed lookup. A lookup still failing when the window runs out is tried again about once a minute
for as long as the wallet runs. A failure waiting cannot fix — a client error (a 4xx response, 429 included, or a
GraphQL error) or an invalid indexer URL — fails at once and is not tried again. It is still a `TransactionHistoryError`,
as before, now marked `retryable: false`; the new optional `retryable` field is absent on every failure that may clear
by waiting.
