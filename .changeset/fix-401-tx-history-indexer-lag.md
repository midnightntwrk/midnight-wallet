---
'@midnightntwrk/wallet-sdk-shielded': patch
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix: keep tx-history shielded/dust sections when the indexer lags events (#401)

When a WS event arrived before the indexer's HTTP endpoint had ingested the tx, `getTransactionDetails` dereferenced an empty result and died with an unretriable `TypeError`, so the shielded/dust section was silently dropped (balances/coins were unaffected). It now fails typed and retries over a bounded, configurable window (`transactionDetailsRetryWindow`, default 2 min); beyond it the loss is logged (`Effect.logError` with the `txHash`) instead of swallowed, and the sync fan-out is capped (`concurrency: 8`). This narrows the race but is not a durability guarantee: if the indexer lags beyond the window the section is still lost (not re-processed), just logged rather than swallowed.
