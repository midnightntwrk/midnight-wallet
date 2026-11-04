---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

Fixes and other changes since 4.x

- `computeBalancingRecipe` no longer loops forever on a wallet holding several part-drained Dust coins. Each pass now
  covers the fee still unpaid over the coins not yet selected, and a pass that selects no coin fails instead of
  repeating. With the loop bounded, Dust the transactions already carry counts toward the fee; a transaction that
  already covers its fee gets an empty balancing transaction, where 4.x looped forever; a coin selection that exhausts
  the pool is retried once largest-first; and a selector that returns a coin it was not offered fails with
  `TransactingError`. `dryRunFee` takes an optional trailing parameter carrying the proof-erased, merged transactions,
  and with no inputs prices the transactions as they are rather than with an extra empty intent.
- Reverting a transaction releases only the Dust it booked. It used to drop decaying Dust coins the transaction never
  spent, and release coins other pending transactions held. A coin a pending transaction spent stays pending through
  syncs, and in the snapshot, until the chain spends it, its lock runs out or it decays to nothing
  (`CoreWallet.settlePendingDust`).
- A reordered event batch is refused whole, and the sync retries from the same position, instead of applying it.
- A transaction's Dust history section is no longer dropped when its event arrives before the indexer can serve the
  transaction's details: the lookup is retried for `transactionDetailsRetryWindow` (default 2 minutes), and a section
  still missing after that is logged with its transaction hash. History lookups run at most eight at a time.
- The sync's retry back-off is really capped at two minutes, with jitter. A second `start()` no longer starts a second
  sync. A Dust wallet syncing from a `Simulator` reports the chain tip and `isConnected`. A block the indexer cannot
  return is a typed error rather than a defect.
