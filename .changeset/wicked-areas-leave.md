---
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
'@midnight-ntwrk/wallet-sdk-facade': patch
---

fix: dynamic fee calculation including balancing transaction costs

- Split `calculateFee` into two methods:
  - `calculateFee` — estimates the fee for a given transaction only (no balancing transaction costs)
  - `estimateFee` — calculates the total fee including the balancing transaction, requiring a secret key, wallet state, and TTL
- Updated `WalletFacade` to expose `calculateTransactionFee` and an updated `estimateTransactionFee` that accepts a secret key and optional TTL/currentTime
- Removed fee overhead constant; fees are now dynamically calculated based on actual coin selection
- Updated `CoinSelection` type to return a single coin (smallest available) instead of multiple coins summed to a target amount
- Added `InsufficientFundsError` to `WalletError` for cases where balancing cannot cover the fee
