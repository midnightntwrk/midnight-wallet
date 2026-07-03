---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(dust-wallet): stop tx-history silently dropping dust sections when the indexer lags ledger events (#401)

Ports the shielded-wallet fix to dust, which had the identical bug: when the WS ledger-events stream delivered an event before the indexer's HTTP `transactions(...)` endpoint had ingested the same hash, `getTransactionDetails` dereferenced an empty result array and died with an unretriable `TypeError` defect — so the retry never engaged, the defect was swallowed, and the dust section of that tx-history entry was permanently lost.

The empty-array case is now a typed failure, so a jittered exponential retry re-queries the indexer for a bounded window (configurable via `transactionDetailsRetryWindow`, default 2 minutes). This narrows the race but is not a durability guarantee: if the indexer lags beyond the window the dust section is still lost — the change is not re-processed, even across restarts — but the failure now surfaces as a structured error carrying the affected `txHash` (via `Effect.logError`) instead of a silent `Console.error` defect. The sync fan-out is also bounded (`concurrency: 8`) so retries don't stampede a lagging indexer. See #533 for the durable-replay follow-up.
