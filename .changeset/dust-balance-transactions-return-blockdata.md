---
'@midnightntwrk/wallet-sdk-dust-wallet': major
---

**BREAKING:** `DustWalletAPI.balanceTransactions` now returns `{ transaction: UnprovenTransaction; blockData: BlockData }` instead of `UnprovenTransaction`. Callers must read the transaction from the `transaction` field; the accompanying `blockData` (hash, height, timestamp, ledger parameters) captured during balancing can be reused downstream to avoid a redundant fetch.

Also exposes the `BlockData` type from the package's public surface.
