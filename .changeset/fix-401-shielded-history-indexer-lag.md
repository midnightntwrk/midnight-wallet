---
'@midnightntwrk/wallet-sdk-shielded': patch
---

fix(shielded-wallet): stop tx-history silently dropping shielded sections when the indexer lags zswap events (#401)

When the WS `ZswapEvents` stream delivered an event before the indexer's HTTP `transactions(...)` endpoint had ingested the same hash, `getTransactionDetails` dereferenced an empty result array and died with an unretriable `TypeError` defect — so the configured retry never engaged, the defect was swallowed, and the shielded section of that tx-history entry was permanently lost (balances/coins still updated).

The empty-array case is now a typed failure, so the existing exponential retry schedule re-queries until the indexer catches up. A sustained outage beyond the retry window now surfaces as a structured warning carrying the affected `txHash` instead of a silent `Console.error` defect.
