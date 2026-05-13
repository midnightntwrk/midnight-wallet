---
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
---

Fix dust fee balancing failing with `InsufficientFunds` despite ample dust (issue #383). Two compounding defects in the dust wallet's coin selection:

- The local `chooseCoin` now skips zero-value coins, so a freshly-registered dust UTXO with `generatedNow === 0` no longer wastes an iteration as the smallest candidate. The local `CoinSelection` type and `chooseCoin` signature were realigned with the capabilities `CoinRecipe` API, and the variant now passes its configured coin selection through to `getBalanceRecipe`. Note: `CoinsAndBalances.CoinSelection` is no longer parametrized — it changed from `CoinSelection<TInput>` to a polymorphic `CoinSelection`. The prior wiring was non-functional (the variant's `coinSelection` slot was never invoked), so any consumer who customized it had no observable behavior; only the type reference needs updating.
- `computeBalancingRecipe` now identifies coins by `token.nonce` rather than by `value` when removing the just-picked coin from the working set. Value-equality previously caused a single pick to drop the entire cohort of dust UTXOs sharing the same `generatedNow` (a routine outcome once their backing Night UTXOs reach `maxCap`), making most of the wallet's spendable dust invisible to the balancer.
