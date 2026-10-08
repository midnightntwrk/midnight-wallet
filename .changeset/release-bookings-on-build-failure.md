---
'@midnightntwrk/wallet-sdk-facade': patch
---

Release the coins a transaction builder booked when the builder fails part-way. `transferTransaction`, `initSwap`,
`balanceUnprovenTransaction`, `balanceUnboundTransaction` and `balanceFinalizedTransaction` book coins in up to three
wallets in turn; when a later step failed — for example, not enough Dust to pay the fee — the earlier bookings stayed,
and since the caller received no transaction it had nothing to revert. Each builder now releases what it booked before
rejecting, in every wallet that booked, along with the reservation record. When balancing a caller's transaction in
place, only the coins the wallet added are released; the caller's own are left as they were.
