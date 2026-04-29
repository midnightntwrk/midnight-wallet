---
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
---

fix(dust-wallet): re-apply fee-sign fix from #293 (lost when closed in favour of #334) — `computeBalancingRecipe` no
longer hangs when `initialFees = 0`.
