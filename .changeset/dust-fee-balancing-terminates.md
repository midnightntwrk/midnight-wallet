---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

Fix `computeBalancingRecipe` looping forever instead of terminating on wallets holding several part-drained dust coins.

The loop had no bound on the number of passes and no check that a pass had made progress. Its first pass was seeded
with the transaction's dust imbalance, which is negative (a deficit); every later pass was seeded with the fee it had
just computed, which is positive. `getBalanceRecipe` treats a non-negative seed as a surplus of dust — it adds a change
output and selects zero inputs — so any wallet whose first pass under-covered its own fee looped forever, rebuilding and
proof-erasing an identical transaction on every pass while its memory grew unbounded.

Each pass now seeds the balancer with the outstanding deficit — the fee still unpaid by the coins already chosen and by
the dust the transactions already carry — over the coins not yet selected, and passes the per-input fee measured so far
as `inputFeeOverhead`, so the second pass normally completes what the first left short. A pass that consumes no coin
fails instead of repeating, which bounds the loop by the pool size. Selected coins keep their selection order, so the
fee is drained from the coins chosen first, as before.

Behaviour that changes as a result, all of it previously unreachable because the loop hung first:

- Dust the transactions already carry — existing spends, registration allowances — now counts toward coverage, so new
  inputs pay only the shortfall rather than the whole fee on top of it. The reported fee remains the total fee of the
  merged result, as `estimateFee` documents.
- A transaction that already covers its fee produces no balancing intent. `balanceTransactions` returns an empty
  transaction, which merges as the identity, instead of an intent with empty `DustActions`, which the ledger rejects.
- If the configured `coinSelection` exhausts the pool without covering the fee, selection is retried once largest-first:
  an additive selection is only guaranteed to find a covering set when it takes coins from the top. A selector that
  declines coins is never overridden and reports insufficient funds directly.
- A selector that returns a coin it was not offered fails with `TransactingError` naming the mismatch, rather than
  pricing the same transaction repeatedly.

`dryRunFee` gains an optional trailing parameter carrying the proof-erased, merged transactions so a caller pricing
several input sets need not merge them once per set; with no inputs it now prices the transactions as they are rather
than with an extra empty intent. No other public API changes.
