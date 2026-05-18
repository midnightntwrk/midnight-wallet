---
'@midnight-ntwrk/wallet-sdk-dust-wallet': minor
---

Add `DustWalletAPI.getLatestBlockData()` for fetching the latest on-chain block data
(hash, height, timestamp, ledger parameters). Each call is a fresh fetch — no caching.
Exposes the `BlockData` type from the package's public surface.
