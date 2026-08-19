---
'@midnightntwrk/wallet-sdk-shielded': major
---

**A shielded variant now reads only the events it is going to apply.** Without this a wallet cannot actually cross a
hard fork on the indexer path, in either direction — which the two-variant wallet in this release depends on.

`Sync.EventsSyncUpdate` carries the event as the indexer served it (`raw`, hex) instead of as a deserialized
`ledger.Event`, and the sync capability deserializes the batch prefix it owns — after the version boundary split, and
after skipping everything at or below its cursor. `Sync.readEvent(update)` is that deserialization, exported for custom
capabilities.

**Breaking for anyone constructing or reading `EventsSyncUpdate` values** — a custom `SyncCapability` over the indexer
updates, or a test fixture building a batch. `update.event` becomes `Sync.readEvent(update)`; a constructed update
carries `raw` rather than `event`. Everything else about the shape, including the per-item `protocolVersion` the
boundary split keys off, is unchanged.

Why it is a correctness fix rather than an optimization: the two ledger versions do not read each other's events — the
serialization header names the version — and a variant meets the other version's bytes in the ordinary course of
crossing a boundary. A pre-fork variant on a chain that has already forked is served post-fork events, which it must
recognise as belonging to the next variant without decoding them; a post-fork variant that has just migrated resumes on
the cursor it inherited, and the source re-delivers a pre-fork event at that position. Deserializing on arrival failed
the whole batch in both cases, so the sync stream retried forever and the wallet never crossed. Reading only what the
variant claims makes both cases ordinary, and an event a variant does claim but cannot read stays a genuine failure,
surfaced as it was before.
