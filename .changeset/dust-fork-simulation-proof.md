---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

Prove the dust hard-fork crossing end to end, against real ledger bytes.

A real ledger-v8 dust chain rewards Night and registers it for dust generation, the pre-fork variant syncs the events
that produced, the indexer reports the boundary version, and the wallet hands over to the ledger-v9 variant with a state
holding no dust at all — then finds the same dust again by syncing the indexer's replayed timeline. That is the
corrected design stated as a test: nothing about the dust crosses the boundary, and everything the wallet ends up
holding it re-discovered through the sync path it uses every day. The two negatives are covered too: a version bump
inside the running variant's range does not migrate, and a wallet whose very first sync already contains the fork
reaches the same end state as one that lived through it.

The replay is modelled by re-framing the pre-fork events. Ledger-v8 frames an `Event` `midnight:event[v9]:` and
ledger-v9 frames it `midnight:event[v14]:`, and each rejects the other's header outright — but everything after that
header is byte-identical for a `dustInitialUtxo` event, so re-framing the same bytes is the whole of the model. The file
opens by asserting exactly that, applying the original events with ledger-v8 and the re-framed ones with ledger-v9 and
comparing the results, so a ledger release that ever changes the encoding retires the model loudly instead of quietly
turning it into a fiction.

**No integration companion, and none is warranted.** The shielded proof needs one because its replay re-mints
_equivalent_ coins, so only the real v8-to-v9 state translation can say whether the tree it rebuilds is the tree the
fork produced. Dust replays the _same_ event bytes, which makes the pre-fork and post-fork wallets directly comparable —
UTXO for UTXO (nonce, backing Night, creation time, initial value, Merkle index) and root for root, on both the
commitment and generation trees — with no WASM artifact and no Rust toolchain involved. So the whole proof is **unit
tier**, `turbo.json` is untouched, and the integration workflow needs no new path case.

Both sides sync through the events path, the one the fork design is written against: its cursor is an indexer event id,
which is the thing the migration parks and the replay counts on from. The replay is numbered as a continuation of the
pre-fork timeline, opening one past the last event the pre-fork variant applied, and the migrated wallet's cursor is
parked on that same id — pinned on the state the migration produced, before any sync has touched it, which is the only
place parking and rewinding are distinguishable.

Two gaps are recorded rather than papered over. There is no dust analogue of the shielded proof's closing spend: dust is
spent as the fee half of a transaction that a chain must validate, and an indexer replay is an event log, not a ledger —
what stands in its place is the commitment-root equality above. And `DustLocalState` gained `commitmentTreeFirstFree`,
`generatingTreeFirstFree` and `nullifiers` only in ledger-v9, so tree _sizes_ cannot be compared across the boundary the
way the shielded proof compares `firstFree`.

No shipped code changes: the wiring this exercises landed with the boundary-wiring change, and the corrected design
needs nothing beyond it. The ledger-v8 dust fixture now exports the seed it derives from, because a wallet crossing the
boundary needs the seed rather than a key — the two variants each build their own `DustSecretKey` from it.
