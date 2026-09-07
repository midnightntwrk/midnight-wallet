---
---

test(dust-wallet): assert what a Dust snapshot carries when the wallet holding it is not empty

Test-only. The existing round trip serializes, deserializes and re-serializes an **empty** wallet, comparing snapshot
bytes with snapshot bytes. Two things escape that shape — a field the snapshot never writes, since neither side has
it, and a change applied to the writer and the reader together — and it is silent about value, because an empty wallet
has none.

These assert the restored wallet's own values over a wallet that has earned real Dust from a real chain: every UTxO
with the generation info underneath it, both merkle tree roots and their first-free indices, the balance valued at one
fixed instant, and the identity, network, protocol version and sync position.

One case is `it.fails`: `pendingDust` is absent from the snapshot schema and the restore path passes an empty array
outright, so a wallet that has spent Dust presents it as available again after any restart. Left failing rather than
fixed — carrying the entry conflicts with the sync-recovery problem of pending state that survives serialization and
can never be cleared, so whatever lands has to carry it *and* give it a way to expire, or record that dropping it is
deliberate. Verified to be a live signal: making the assertion hold reports `Expect test to fail`.

Mutation-verified: dropping the sync position from the snapshot leaves **234 of 235** unit tests green and fails only
the new case; restoring a rebuilt empty state rather than the carried one leaves **231 of 235** green, failing three of
these and one existing restore case — while the empty-wallet round trip passes both mutations.
