---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
'@midnight-ntwrk/wallet-sdk-facade': patch
---

Adds optional balancing support and refactors wallet facade API methods.

**Breaking Changes:**
- All balancing methods (`balanceFinalizedTransaction`, `balanceUnboundTransaction`, `balanceUnprovenTransaction`) now accept parameters as grouped objects (`secretKeys` and `options`) instead of individual parameters
- The `transferTransaction` and `initSwap` methods now group parameters into `secretKeys` and `options` objects
- Renamed `signTransaction` to `signUnprovenTransaction`

**New Features:**
- Add `options.tokenKindsToBalance` parameter to balancing methods, allowing selective balancing of specific token types (dust, shielded, unshielded) instead of always balancing all types
- Add `options.payFees` parameter to `transferTransaction` and `initSwap` methods to control fee payment
- Add new `signUnboundTransaction` method

**Internal Changes:**
- `balancingTransaction` is now optional in `UnboundTransactionRecipe` when only unshielded balancing is performed
