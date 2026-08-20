---
'@midnightntwrk/wallet-sdk-shielded': minor
---

Make the shielded wallet able to follow the chain across a hard fork: sync now recognises the protocol version the
indexer reports, hands over at the variant boundary, and starts the next ledger version's variant on a fresh state.

**Behavioural change: wallet state now tracks the reported protocol version.** Until now nothing wrote the indexer's
`protocolVersion` into the wallet state, so it stayed pinned at its initial value and a protocol version change could
never be signalled. It is now recorded on every applied batch. The value only ever increases — a source that briefly
reports an older version (a reconnect replaying from an earlier cursor, say) cannot drag the wallet back below a
boundary it has already crossed.

**Breaking for custom `withSync` authors: `SyncCapability.applyUpdate` takes a third argument.** The signature is now
`applyUpdate(state, update, activeRange)`, where `activeRange` is the half-open protocol version range the running
variant owns, derived from `withVariant(sinceVersion)` registration. A custom capability must accept it and split its
batch at the boundary: everything from the first item at or beyond the range's end belongs to the next variant and must
be left unapplied, with the applied index stopping at the last item actually applied so that suffix is re-fetched rather
than skipped. `splitAtVersionBoundary` and `annotateVersion` are exported from the `Sync` module and implement exactly
that rule — the built-in indexer and simulator capabilities both go through them, and a custom capability should too.

A variant also emits a version change when the state it _starts_ from already sits outside its range, which heals a
snapshot serialized between the annotation and the migration it should have caused.

**New: configurable state migration.** Each variant gains a `Migration` module and the builder gains `withMigration` /
`withMigrationDefaults`, so how a variant produces its first state from whatever preceded it is a build-time choice
rather than a fixed one. Three strategies ship: `makeEmptyWalletMigration` (an empty wallet, which is what an
unconfigured builder has always produced and what `startEmpty` relies on — unchanged), `makeCarryOverMigration` (carry
state unchanged between two variants of the same ledger version), and `makeCrossLedgerMigration` (start the next ledger
version fresh). A builder that never mentions migration keeps building and behaves exactly as before.

**Crossing a ledger version carries identity and position, and no coins.** The indexer replays the timeline after the
fork, re-emitting the wallet's history as events of the new ledger version, so a migrated wallet re-discovers exactly
the same coins by ordinary synchronization — decrypting them with the keys the sync restart supplies.
`makeCrossLedgerMigration` therefore carries the public keys, the network and the protocol version that triggered the
hand-over onto an empty local state, and carries no coins: doing so would double-count what the replay is about to
deliver, and rebuilding a Merkle tree needs secret keys that migration by design does not have.

Sync progress is **parked at the fork**: the previous variant's cursor crosses unchanged. The replay is not a second
timeline but the same one continuing — the indexer numbers the replayed events onwards from whatever id it had reached
when the fork happened, never from zero — so a migrated wallet resumes from the inherited cursor and meets the replay
there. Rewinding to zero would leave it waiting on a stretch of history that the new ledger version's events do not
occupy. `isConnected` is the one part of progress that does not cross: nothing is synchronizing behind a just-migrated
state until the restart reconnects it.

`ShieldedWallet.start` now holds on to the keys it was given and re-establishes background synchronization on the
variant a migration activates; `stop` releases them. Previously a migration left the wallet with no running sync, and no
keys to restart it with.

The shielded wallet registered a single ledger-v9 variant when this landed, so on its own it changed nothing about a
live wallet's behaviour. It is the wiring the two-variant wallet in this same release runs on.
