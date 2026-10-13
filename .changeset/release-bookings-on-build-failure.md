---
'@midnightntwrk/wallet-sdk-facade': minor
---

Release the coins a transaction builder booked when the builder fails part-way. `transferTransaction`, `initSwap`,
`balanceUnprovenTransaction`, `balanceUnboundTransaction` and `balanceFinalizedTransaction` book coins in up to three
wallets in turn; when a later step failed (for example, not enough Dust for the fee) the earlier bookings stayed, and
the caller had no transaction to revert. Each builder now releases what it booked, and its reservation record, before
rejecting. Balancing in place releases only the coins the wallet added. If a release itself fails, the builder throws
an `AggregateError` with the original error first and each failed release after it; otherwise the original error is
rethrown unchanged.
