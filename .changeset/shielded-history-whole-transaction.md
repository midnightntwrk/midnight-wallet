---
'@midnightntwrk/wallet-sdk-shielded': patch
---

fix(shielded-wallet): write each transaction to tx history once, whole

The built-in events sync (`makeEventsSyncService`) now batches indexer events by whole transaction, in both the v1 and
v2 variants. A batch used to end wherever `batchUpdates.size` or `batchUpdates.timeout` cut it, often between a
transaction's spent and received coins, and each half was written to tx history on its own. A reader could then see a
sender's entry with no spent coins for a moment, and a wallet stopped between the halves could keep it that way.

A transaction is held until its last event has arrived, then applied and written in one go; a wallet stopped part-way
fetches it again from the start. A transaction with more events than `batchUpdates.size` is never split: it arrives
alone, in a batch larger than `size`. A batch now ends only between transactions, so one still arriving is held past
`batchUpdates.timeout`.

History writes for a batch the variant has applied now run in the runtime's scope rather than the variant's, so a
hand-over to the next variant no longer cuts them off, and wallet calls go to the next variant at once while they
finish. `stop()` still interrupts them straight away.
