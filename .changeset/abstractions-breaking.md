---
'@midnightntwrk/wallet-sdk-abstractions': major
---

Breaking changes since 2.x

- Transaction history follows each transaction's lifecycle. `TransactionHistoryStorage` replaces `upsert` with
  `gotPending`, `gotFinalized` and `gotRejected`, split across the `TransactionHistoryReader` and
  `TransactionHistoryWriter` interfaces. `TransactionHistoryCommon` and `TransactionHistoryCommonSchema` are now
  `TransactionHistoryEntryCommon` and `TransactionHistoryEntryCommonSchema`, which require a `lifecycle` (`pending`,
  `finalized` or `rejected`) and `identifiers`, while `protocolVersion` and `status` become optional, known once the
  chain has settled the transaction; extend them with `extendEntrySchema`. A recorded inclusion wins over a later
  rejection: `gotRejected` writes nothing for a transaction a finalized entry covers, and `gotFinalized` clears the
  pending and rejected entries it covers under another hash (`coversTransaction` is the test). A custom storage must
  follow the same rules.
- Histories are saved as `{ version: 'v2', entries }`, which 2.x cannot open. A history saved by 2.x (a bare array)
  still restores, each entry as `finalized`, with empty `identifiers` where it had none.
- `InMemoryTransactionHistoryStorage.restore` throws `TransactionHistoryFormat.TransactionHistoryRestoreError`, which
  carries a `reason`, instead of the parser's own error; the new `tryRestore` returns it as a `Left`.
  `NoOpTransactionHistoryStorage.serialize` writes an empty `v2` history.
- `ProtocolState` requires a `variantTag`, naming the variant whose state it holds.
