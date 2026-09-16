---
'@midnightntwrk/wallet-sdk-shielded': patch
---

fix(shielded): keep equal-value coins when balancing a fallible section

Balancing a fallible section removed every remaining candidate coin that shared a type and a value with the one just
selected, because the fallible path passed a value-based `isCoinEqual` predicate to `getBalanceRecipe`. Shielded coins
are told apart by their nonce, so a deficit needing several equal-value coins failed with `InsufficientFundsError`
even though the wallet held the funds. The fallible path now uses the nonce-based predicate the guaranteed path
already used, in both the V1 and V2 variants.
