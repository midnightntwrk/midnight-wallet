---
'@midnightntwrk/wallet-sdk-shielded': patch
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(shielded-wallet,dust-wallet): retry indexer server errors when looking up a transaction's history details

- A history lookup now retries a server error (indexer down, unreachable or 5xx) within `transactionDetailsRetryWindow`,
  as it already did for a transaction not yet indexed, so a short outage no longer drops the entry.
- A lookup still failing after the window is tried again about once a minute while the wallet runs.
- A client error (4xx, 429 included, or a GraphQL error) or an invalid indexer URL fails at once and is not retried. It
  is still a `TransactionHistoryError`, now with `retryable: false`; the new optional field is absent on failures that
  may clear by waiting.
