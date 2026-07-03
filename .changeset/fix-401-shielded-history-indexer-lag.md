---
'@midnightntwrk/wallet-sdk-shielded': patch
---

fix(shielded-wallet): stop tx-history silently dropping shielded sections when the indexer lags zswap events (#401)

When the WS `ZswapEvents` stream delivered an event before the indexer's HTTP `transactions(...)` endpoint had ingested the same hash, `getTransactionDetails` dereferenced an empty result array and died with an unretriable `TypeError` defect — so the configured retry never engaged, the defect was swallowed, and the shielded section of that tx-history entry was permanently lost (balances/coins still updated).

The empty-array case is now a typed failure, so a jittered exponential retry re-queries the indexer for a bounded window (configurable via `transactionDetailsRetryWindow`, default 2 minutes) to ride out the ingest lag. This narrows the race but is not a durability guarantee: if the indexer lags beyond the window the shielded section is still lost — the change is not re-processed, even across restarts — but the failure now surfaces as a structured error carrying the affected `txHash` (via `Effect.logError`) instead of a silent `Console.error` defect. The sync fan-out is also bounded (`concurrency: 8`) so retries don't stampede a lagging indexer.
