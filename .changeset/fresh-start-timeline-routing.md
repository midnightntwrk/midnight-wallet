---
'@midnightntwrk/wallet-sdk-capabilities': minor
---

**A wallet with no snapshot now starts on the version the chain's timeline starts under, not the version its tip is
on.** The default chain-version probe asks the indexer for the protocol version of the chain's first block instead of
its latest one, and the exported effect behind it is named for that question: `currentChainVersion` becomes
`timelineStartChainVersion` (and `LatestBlockAnswer`, the shape it reads, becomes `BlockVersionAnswer`).

The tip's version answers "which variant do I transact on"; a fresh start needs the other question answered — "which
ledger version wrote the first event I am about to fetch". On a chain that hard-forked over existing history the two
differ, and routing on the tip starts the wallet on the post-fork variant, which then reads pre-fork history it cannot
deserialize and ends up holding nothing. Routing on the timeline's start puts it on the pre-fork variant, which reads
that history, and the hand-over carries what it found across the boundary. A chain that has been post-fork since its
own genesis has no pre-fork history, so it still starts a fresh wallet directly on the post-fork variant, with no
hand-over. A chain that reports no block still answers nothing, and a wallet that hears nothing still starts pre-fork,
exactly as before.

Applications supplying their own `chainVersionProbe` should answer the same question — the version of the chain's first
block. One that reports the tip is not wrong about the chain, it is answering a different question, and on a forked
chain with history it strands the wallet on a ledger version that cannot read what it is served.

One known consequence, tracked separately: on a chain that has forked but produced no post-fork traffic this wallet can
see, a fresh wallet now sits on the pre-fork variant until an event carries the new version to it. Nothing is lost, but
the wallet believes it is pre-fork for as long as the chain stays quiet. Closing that needs a version watcher that
observes the boundary independently of the events the wallet is served, which is the next increment.
