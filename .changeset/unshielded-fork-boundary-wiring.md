---
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
---

Make the unshielded wallet able to follow the chain across a hard fork: sync now recognises the protocol version the
indexer reports, hands over at the variant boundary, and carries the wallet's UTXOs into the next ledger version's
variant.

**Behavioural change: wallet state now tracks the reported protocol version.** Until now nothing wrote the indexer's
`protocolVersion` into the wallet state, so it stayed pinned at its initial value and a protocol version change could
never be signalled. It is now recorded on every applied transaction. The value only ever increases — a source that
briefly reports an older version (a reconnect replaying from an earlier cursor, say) cannot drag the wallet back below
a boundary it has already crossed. Progress messages never touch it: the wire schema carries no version on them.

**Breaking for custom `withSync` authors: `SyncCapability.applyUpdate` takes a third argument.** It is now
`applyUpdate(state, update, activeRange)`, where `activeRange` is the half-open protocol version range the running
variant owns. Implementations that ignore the parameter keep their present behaviour; the exported
`isBeyondActiveRange` and `annotateVersion` helpers implement the rule for anyone who wants it.

Unshielded's boundary rule is per message, not per batch, because its sync delivers one transaction at a time. A
transaction reported at or beyond the end of the range is left **entirely** unapplied — no UTXO change, no `appliedId`
movement, no transaction-history write — and only its version is recorded. Because the cursor does not move, the next
variant re-fetches that same transaction and applies it exactly once.

**New: the migration seam.** `Migration.ts` exports `StateMigration` with three instances —
`makeEmptyWalletMigration` (no previous wallet), `makeCarryOverMigration` (same ledger version), and
`makeCrossLedgerMigration` (across a fork). The builder gains `withMigration` and `withMigrationDefaults` plus a
defaulted `TPreviousState` type parameter, and `migrateState` — which until now ignored its argument and rebuilt a
placeholder wallet from a fixed seed, so a ledger-v8 wallet would have been silently replaced by an empty one — runs
the configured strategy. The strategy is optional, defaulting to the empty-wallet migration, so no existing
`build({ ... })` call site changes.

The cross-ledger strategy is a **structural carry**, and this is where the unshielded wallet differs from the shielded
and dust ones. Those start the new variant on a fresh, empty state and let the indexer's post-fork replay hand their
coins back, because their coins are shielded and re-deriving them needs secret keys a migration by design never
receives. Unshielded UTXOs are public ledger data held as plain records, so every one of them is simply rebuilt on the
other side — available and pending, field for field — with no replay to wait for and no window in which the wallet
reports a balance it does not have. The verifying key is widened from ledger-v8's bare hex string to ledger-v9's
`{tag, value}` record, defaulting to `schnorr` because that ledger version had exactly one signature scheme. The sync
cursor is carried unchanged: parked at the boundary, neither rewound nor advanced.

**Sync now restarts itself after a migration.** `UnshieldedWallet.start` registers a runtime activation watcher that
re-dispatches `startSyncInBackground` onto the newly activated variant; the class registered no watcher at all before.
Unlike the shielded and dust wallets it retains no key, because unshielded sync is watch-only and signing is supplied
per call by the caller — the restart needs no argument at all. `stop` marks the wallet stopped so a late activation
cannot resurrect it.

A state restored from a snapshot taken between the version being recorded and the runtime acting on it now emits an
immediate healing version change instead of stalling on a version its variant does not own.
