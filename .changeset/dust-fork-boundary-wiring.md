---
'@midnightntwrk/wallet-sdk-dust-wallet': minor
---

Make the dust wallet able to follow the chain across a hard fork: sync now recognises the protocol version the indexer
reports, hands over at the variant boundary, and starts the next ledger version's variant on a fresh state.

**Behavioural change: wallet state now tracks the reported protocol version.** Until now nothing wrote the indexer's
`protocolVersion` into the wallet state, so it stayed pinned at its initial value and a protocol version change could
never be signalled. It is now recorded on every applied batch that reports one. The value only ever increases — a source
that briefly reports an older version (a reconnect replaying from an earlier cursor, say) cannot drag the wallet back
below a boundary it has already crossed.

**Breaking for custom `withSync` authors: `SyncCapability.applyUpdate` takes a third argument.** It is now
`applyUpdate(state, update, activeRange)`, where `activeRange` is the half-open protocol version range the running
variant owns. Anything the source reports at or beyond its end belongs to a later variant and must be left unapplied for
that variant to fetch. Implementations that ignore the parameter keep their present behaviour; the exported
`splitAtVersionBoundary` and `annotateVersion` helpers implement the rule for anyone who wants it.

**`SyncEventsUpdateSchema` gains an optional `protocolVersion`.** Optional because dust's subscription does not select
the field yet — the indexer schema defines it on `DustLedgerEvent`, but adding the selection-set line waits on
confirmation against a deployed indexer. Until then every item arrives without it, and an absent value means "the
indexer did not say": the event applies normally and the recorded version is left alone. Reading a missing value as zero
would drag the version down and, on a wallet already past the boundary, look like a migration backwards.

**New: the migration seam.** `Migration.ts` exports `StateMigration` with three instances — `makeEmptyWalletMigration`
(no previous wallet), `makeCarryOverMigration` (same ledger version), and `makeCrossLedgerMigration` (across a fork).
The builder gains `withMigration` and `withMigrationDefaults`, and `migrateState` — which until now handed the previous
state straight back, so a ledger-v8 wallet would have been passed off as a ledger-v9 one — runs the configured strategy.

The cross-ledger strategy carries the dust public key, the network, the protocol version that triggered the hand-over,
and the sync cursor. It carries no dust. After a fork the indexer replays the timeline, so exactly the same dust is
generated again by events of the new ledger version and re-discovered by ordinary sync; carrying it as well would
double-count it. Sync progress is **parked at the fork** rather than rewound, because the replay continues the indexer's
event ids from wherever it had reached rather than restarting them.

**New: `dustParameters` on the builder configuration, optional.** Dust's local state is parameterised where shielded's
is not, so an empty or migrated state cannot be constructed without dust parameters. It defaults to the ledger's initial
parameters, so no existing `build({ ... })` call site changes.

**Sync now restarts itself after a migration.** `DustWallet.start` retains the `DustSecretKey` in memory for the
wallet's lifetime and registers a runtime activation watcher that re-dispatches `startSyncInBackground` onto the newly
activated variant. The key never enters serialized state, and `stop` clears it so a stopped wallet cannot be resurrected
by a late activation. A state restored from a snapshot taken between the version being recorded and the runtime acting
on it now emits an immediate healing version change instead of stalling on a version its variant does not own.

**Known limitation: the projections-based fast-sync path does not implement the boundary.** A projections update is a
folded snapshot of dust state, not a run of version-tagged timeline items, and `BlockData` carries no protocol version —
so there is nothing to split and nothing to record. `makeEventLessSyncCapability` accepts the activation range for
signature parity and does not act on it, which means a wallet syncing exclusively that way will not hand over at a fork.
Closing this needs a protocol version on the projections wire format. It is pinned by a test rather than left implicit.
