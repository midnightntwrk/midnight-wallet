---
'@midnightntwrk/wallet-sdk-shielded': patch
---

Fixes and other changes since 3.x

- Coins booked for a transaction that is never submitted, or never included, are released. Such a booking was saved with
  the wallet and never cleared, so an abandoned transaction locked its coins for good, across restarts. A booking is now
  released once its transaction's TTL has passed, or 14 days after sync first saw it if that is sooner, and only once
  sync has caught up. A quiet chain still releases them: the sync checks in every version-watch interval.
- A partially successful transaction no longer has all its coins released while the chain has spent some:
  `revertFailedSegments(tx, failedSegments)` releases only the coins booked in its failed segments, and the facade now
  uses it instead of reverting the whole transaction.
- Balancing a fallible section no longer fails with `InsufficientFundsError` when the deficit needs several coins of the
  same type and value: candidates are told apart by nonce, as the guaranteed section already did.
- A reordered event batch is refused whole, and the sync retries from the same position, instead of applying it.
- A shielded wallet syncing from a `Simulator` reports the chain tip and `isConnected`, so it can become complete.
- A transaction's shielded history section is no longer dropped when its event arrives before the indexer can serve the
  transaction's details: the lookup is retried for `transactionDetailsRetryWindow` (default 2 minutes), and a section
  still missing after that is logged with its transaction hash. History lookups run at most eight at a time.
- The transaction history embedded in a 1.0.0 snapshot survives restoring and saving.
- The README examples use real shielded token types rather than `'NIGHT'`, which is unshielded.
