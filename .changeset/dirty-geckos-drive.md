---
'@midnight-ntwrk/wallet-sdk-dust-wallet': major
---

**BREAKING:** `getAvailableCoins`, `getPendingCoins`, and `getTotalCoins` now return `DustFullInfo` (with generation details) instead of raw `Dust`. Access the underlying `Dust` via the `.token` property. Removes `getAvailableCoinsWithFullInfo`, `getPendingCoinsWithFullInfo`, and `getTotalCoinsWithFullInfo`. The methods now accept an optional `time` parameter, defaulting to `syncTime`.
