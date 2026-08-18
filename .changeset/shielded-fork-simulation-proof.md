---
'@midnightntwrk/wallet-sdk-shielded': patch
---

Prove the hard-fork crossing end to end, against real ledger bytes.

A ledger-v8 chain pays a wallet, the pre-fork variant syncs it, the chain reaches the boundary height, and the wallet
hands over to the ledger-v9 variant with a fresh state — then finds the same coins again by syncing the indexer's
replayed timeline, and spends them. That is the corrected design stated as a test: nothing about the coins crosses the
boundary, and everything the wallet ends up holding it re-earned through the sync path it uses every day. The two
negatives are covered too: a version bump inside the running variant's range does not migrate, and a wallet whose very
first sync already contains the fork reaches the same end state as one that lived through it.

The replay is modelled with the thing the wallet's sync path already consumes — a second chain that re-announces every
pre-fork commitment as a post-fork transaction. A commitment is a function of the coin and its owner's public key, so
re-paying the same coin reproduces it exactly, and replaying the whole sequence in order reproduces the tree. No state
translation is needed to model that, so the crossing is proven **unit tier**, with no toolchain.

That chain is numbered as a continuation of the pre-fork one, opening at the boundary height rather than at zero,
because block numbers stand in for the indexer's event ids and the indexer counts its replay on from the id the fork
found it at. The migrated wallet's cursor is parked on that same height, and the proof pins it there — on the state the
migration produced, before any sync has touched it. The pairing is what makes the timeline work: a wallet parked at the
fork in front of a replay numbered from zero syncs nothing at all.

**The fidelity link is integration tier.** What a unit test cannot say is whether the model is faithful. So the same
crossing runs again with the pre-fork chain handing its own serialized ledger to the ledger team's real v8-to-v9 state
translation, and the two reconstructions are checked against each other: the tree the wallet rebuilds from replayed
events has the same Merkle root as the tree the translation produced, and the chain holding the translated ledger
accepts a spend whose Merkle path the wallet built from a tree it learned entirely from the replay. Both hold.

That proof is integration tier because the translation is a WASM artifact built from `packages/state-translation`. This
package's `turbo.json` now declares `test:integration` dependent on that package's `build:wasm`, mirroring
`packages/capabilities` — so **running this package's integration tests requires a Rust toolchain**, while `dist`,
`typecheck`, `lint` and `test:unit` do not. The package also gains `@midnightntwrk/wallet-sdk-state-translation` as a
devDependency; nothing shipped depends on it.

No shipped code changes: the wiring this exercises landed with the boundary-wiring change, and the corrected design
needs nothing beyond it.
