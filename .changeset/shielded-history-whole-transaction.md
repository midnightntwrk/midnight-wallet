---
'@midnightntwrk/wallet-sdk-shielded': patch
---

fix(shielded-wallet): write each transaction to tx history once, whole

The built-in events sync (`makeEventsSyncService`) now batches indexer events by whole transaction, in both the v1 and
v2 variants. A batch used to end wherever `batchUpdates.size` or `batchUpdates.timeout` cut it, often between a
transaction's spent and received coins, and each half was written to tx history on its own. A reader could then see a
sender's entry with no spent coins for a moment, and a wallet stopped between the halves could keep it that way.

A transaction is held until its last event has arrived, then applied and written in one go; a wallet stopped part-way
fetches it again from the start. `batchUpdates.size` is still the most events a batch carries: only a transaction with
more events than that is split across batches.

History writes for a batch the variant has applied now run in the runtime's scope rather than the variant's, so a
hand-over to the next variant no longer cuts them off, and wallet calls go to the next variant at once while they
finish. `stop()` still interrupts them straight away.
