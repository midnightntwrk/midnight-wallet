---
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-facade': major
---

Pending transactions now know which protocol version they were authored for, and the wallet gives up on the ones a
fork left behind instead of waiting out their TTL.

A transaction's bytes, identifiers and TTL only mean anything under the ledger version it was authored against, so one
trait for the whole pending set could only ever hold transactions of a single version. `VersionedTransactionTrait` is a
`ProtocolVersion.Registry` of traits — the same primitive variant and codec selection use — and each pending item
carries the version the chain had reached when it was authored. The trait that reads an item is chosen by that stamp;
an item with no stamp is read with the oldest registered trait, which is also how envelopes written before stamping
existed keep deserializing.

Two consequences beyond routing. Merging only considers items from the same version epoch, because whether one
transaction supersedes another is a question only a single ledger version can answer. And `orphanBeyond(chainNow)`
gives every unresolved item whose epoch the chain has moved past a verdict of its own — `ORPHANED_BY_FORK`, naming
`authoredFor` and `chainNow`. It is deliberately not one of the indexer's statuses: the chain never reported anything
about the transaction and never will, because bytes authored under the previous protocol version cannot be included
under the new one. `allRejected` puts orphans on the same revert path as reported failures, and the facade records
`reason: 'orphaned-by-protocol-upgrade'` on the transaction history entry.

The facade drives this from the protocol version its three wallets have all reached. An item stamped with no version
is never orphaned — not knowing what a transaction was authored for is not evidence it was left behind.

**What you must change**

- `PendingTransactions.{has,addPendingTransaction,clear,saveResult,serialize,deserialize}` and
  `PendingTransactionsServiceImpl.{init,restore}` take a `VersionedTransactionTrait` instead of a `TransactionTrait`.
  A wallet that speaks one ledger version wraps its trait: `PendingTransactions.singleTrait(myTrait)`.
- `addPendingTransaction(tx)` becomes `addPendingTransaction(tx, protocolVersion)`, where `protocolVersion` is an
  `Option` of the version the transaction was authored for.
- A custom `PendingTransactionsService` must implement `orphanBeyond(chainNow)`.
- `facade.revert` / `facade.revertTransaction` take an optional trailing `reason`. Existing calls are unaffected.

`FacadeState.pending` keeps its shape; orphaned entries appear on it as items whose `result.status` is
`'ORPHANED_BY_FORK'`.
