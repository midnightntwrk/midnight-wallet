---
'@midnightntwrk/wallet-sdk-shielded': patch
---

fix(shielded-wallet): write each transaction to tx history once, whole

The built-in events sync (`makeEventsSyncService`) now batches indexer events by whole transaction, in both the v1 and
v2 variants. A batch used to end wherever `batchUpdates.size` or `batchUpdates.timeout` cut it, often between a
transaction's spent and received coins, and each half was written to tx history on its own. A reader could then see a
sender's entry with no spent coins for a moment, and a wallet stopped between the halves could leave it that way until it
synced again.

A transaction is held until it is known whole — once the next transaction's first event has arrived, or once it reaches
the last event the indexer holds — then applied and written in one go; a wallet stopped part-way, or a subscription that
ends part-way, fetches it again from the start. A batch is emitted as soon as it holds `batchUpdates.size` events or
more, and may exceed `size` by the rest of the transaction that filled it, since a transaction is never split. A batch
ends only between transactions, so a transaction still arriving is held past `batchUpdates.timeout`.

History writes for a batch the variant has applied now run through the runtime, beyond the variant that applied it, so a
hand-over to the next variant no longer cuts them off, and wallet calls go to the next variant at once while they
finish. `stop()` first stops the wallet syncing, then gives the writes still running up to one second, shared by
every variant that has run, to land, so a transaction the wallet has just applied is still recorded; a write still
running after that is interrupted, logged with its transaction hash, and not recorded.
