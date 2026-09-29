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
`@midnightntwrk/wallet-sdk-abstractions` beside `versionField`, with `isSnapshotWriter` to narrow a name to the writers
a build knows. The field accepts any name, so a later variant naming itself does not turn a format this build reads
into one it refuses; a name this build does not know routes by version, as no name does.

What this covers for snapshots already on disk differs by surface. An unshielded snapshot written in the fork window
by a build before this one still goes home, because the bare-string verifying key it carries is a shape only the V1
variant ever wrote, and routing reads that as the writer when no name is present. Shielded and dust snapshots carry
nothing in their shape that says who wrote them, so one written in the fork window by a build before this one still
opens on the V2 variant as a format upgrade, as before; a wallet in that state needs a resync to release stranded
shielded spends. Snapshots written from this release on name their writer and go home on every surface.
