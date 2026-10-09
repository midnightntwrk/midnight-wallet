---
'@midnightntwrk/wallet-sdk-facade': patch
---

fix(facade): record the reservation for a transaction balanced in place

`balanceUnprovenTransaction` and `balanceUnboundTransaction` now record the coins they book. The coins are read off the
transaction before and after balancing rather than off the wallet's published state, which can lag the balancing call
and left the booking unrecorded.
