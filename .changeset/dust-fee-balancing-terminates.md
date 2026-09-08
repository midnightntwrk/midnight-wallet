---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

Fix `computeBalancingRecipe` looping forever instead of terminating on wallets holding several part-drained dust coins.

The loop had no bound on the number of passes and no check that a pass had made progress. Its first pass was seeded
with the transaction's dust imbalance, which is negative (a deficit); every later pass was seeded with the fee it had
just computed, which is positive. `getBalanceRecipe` treats a non-negative seed as a surplus of the fee token — it adds
a change output and selects zero inputs — so any wallet whose first pass under-covered its own fee looped forever,
rebuilding and proof-erasing an identical transaction on every pass while its memory grew unbounded.

Each pass now seeds the balancer with the outstanding deficit rather than the raw fee, which both corrects the sign
and bounds the loop: adding an input can only raise the fee, so a pass that does not converge has strictly grown the
input set, and a finite coin pool bounds the number of passes.

Since the additive loop is only complete when it selects from the top — an ascending order can take a small coin, be
forced to add a large one to cover the resulting fee, and find the pair still short when the large coin alone would
have paid — a pass that ends in `InsufficientFundsError` is now retried once, greedily by value, before the error is
reported. This can select coins in an order other than the caller's configured `coinSelection` on that one retry.

No public API changes.
