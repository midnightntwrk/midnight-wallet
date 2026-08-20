---
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-indexer-client': minor
---

Dust reads an indexer payload only when the variant that owns it is about to apply it.

Both dust variants meet the other ledger version's bytes in the ordinary course of crossing a protocol boundary: a
batch that straddles the fork carries the events that follow it, the inclusive cursor a migrated variant inherits
re-delivers the event its predecessor last applied, and the nullifier lookup searches from block zero and so matches
pre-fork blocks whole. None of that is an error — it is what the boundary looks like — but the sync schemas
deserialized on arrival, so each of those failed the entire payload, the stream retried, fetched the same payload, and
failed again. **Forever, in both directions.** This is the same defect the shielded wallet fixed, in dust's own sync
path, and it is a prerequisite for a dust wallet that can cross a fork at all.

The bytes now cross the schema boundary as the indexer served them, and are read where the version that may read them
is known:

- `SyncEventsUpdateSchema.raw` is a hex string in both twins; the sync capability calls the new `readEvent` on exactly
  the batch prefix its activation range claims, and never on what it defers.
- `TransactionEvent.raw` (the nullifier lookup) is a hex string; the new `matchedDustSpends` reads the events out of a
  matched transaction and skips the ones this ledger version cannot — a lookup that matches on a nullifier _prefix_,
  from block zero, over-delivers by design, so an unreadable event is by construction not one of this wallet's spends.
- A matched transaction's block now carries `protocolVersion` alongside its still-encoded `ledgerParameters`, and those
  parameters are decoded through the `LedgerParametersCodec` registry — the same routing `makeBlockDataSchema` already
  used — only for a block holding a spend this wallet owns.
- `CollapsedMerkleTreeSchema.update` and the dtime item's `treeInsertionPath` are hex strings, read by
  `readCollapsedUpdate` and `readGenerationTreeInsertionPath` at the point the wallet applies them.

BREAKING CHANGE — `WalletSyncSubscription.raw`, `CollapsedMerkleTree.update` and `DustGenerationDtimUpdate.treeInsertionPath`
are `string` (hex) rather than decoded ledger objects. `createDustUtxoUpdates` takes the already-read spends
(`matchedDustSpends(nullifierTransactions)`) instead of the raw subscription payloads, and accepts the ledger
parameters codecs to read a matched block's parameters with.

The `DustLedgerEvents` subscription now selects `protocolVersion`, which the indexer has always exposed on
`DustLedgerEvent`; the field stays optional in the schema so an indexer that omits it keeps meaning "did not say",
which is treated as in-range rather than as version zero.
