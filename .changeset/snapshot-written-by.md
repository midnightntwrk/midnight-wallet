---
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-abstractions': minor
---

Route a restored snapshot to the variant that wrote it, so a snapshot saved in the fork window still migrates.

Every wallet snapshot now records which variant wrote it, as `writtenBy: 'v1'` or `'v2'`. The field is optional, so
the format version does not change and every snapshot written before it exists still opens.

It fixes a real gap. A V1 wallet that has seen the chain reach `forks.v9` annotates that version onto its state before
the runtime hands it over, so a snapshot it writes in that window carries a version the V2 variant owns. Routed by the
version alone, such a snapshot opened straight on the V2 variant as a format upgrade and skipped the cross-ledger
migration: the UTXOs booked for a ledger-v8 transaction stayed pending forever, the Night UTXO kept
`registeredForDustGeneration: true`, and stranded shielded spends were never released. Routed to the variant that wrote
it, the V1 variant announces the out-of-range version on its first observation and the runtime migrates it, exactly as
for a live crossing.

A build that registers only the V2 variant has nothing to migrate with, so it goes on reading a V1-written snapshot as
a format upgrade, as before. `SnapshotFormat.writtenByField` and the writer constants live in
`@midnightntwrk/wallet-sdk-abstractions` beside `versionField`.
