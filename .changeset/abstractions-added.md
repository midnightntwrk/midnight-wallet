---
'@midnightntwrk/wallet-sdk-abstractions': minor
---

Additions since 2.x

- `WalletTransaction`, a handle that carries a transaction together with the protocol version it was built for and its
  stage, `'Unproven'`, `'Unbound'` or `'Finalized'` (typed `UnprovenTx`, `UnboundTx` and `FinalizedTx`, or `AnyTx` for
  any). Seal a ledger transaction with `WalletTransaction.adopt(stage, tx, protocolVersion)`. Read it back with
  `WalletTransaction.unwrapWithin(handle, range)`, an `Either` that fails with `ProtocolVersionMismatchError` for the
  other ledger version and with `ForeignTransactionHandleError` for a handle sealed by another copy of the package. Move
  it across a process boundary with `toWire` and `fromWire` (`WireFormatError`).
- `ProtocolVersion.ForkSchedule`, `V9NativeForkVersion` (2000000, the value a 2.x node reports), `V9NativeForkSchedule`
  (`{ v9: V9NativeForkVersion }`) and `epochOf`, and `ProtocolVersion.Registry`, which keys values such as codecs,
  provers or variants by the protocol-version range each serves (`makeRegistry`, `makeRegistryFromActivations`,
  `select`).
- `IndexerLiveness`, the verdict of cross-checking an indexer against a node (`InSync`, `Ahead`, `Behind`, `Unknown`,
  `WrongNetwork`, `Unavailable` or `Skipped`), with `evaluate`, `evaluateTips`, `blocksSyncCompletion`, `equivalent` and
  `sameBlockHash`.
- `SnapshotFormat`, `SnapshotRouting` and `TransactionHistoryFormat`, the primitives with which a wallet package
  versions what it saves: it records a snapshot's format `version` and the variant that wrote it (`versionField`,
  `writtenByField`), routes a snapshot to that variant on restore (`routeSnapshot`), and refuses an unknown version with
  `SnapshotRestoreError` (`readSnapshot`). With `readSnapshotWithUnknownFields`, `writeSnapshot` and `withUnknownFields`
  it keeps the fields it does not declare and writes them back, so a field written by a later release survives a
  rollback.
- `Token.night`, `TokenType`, `parseTokenType` and `InvalidTokenTypeError`, so token types need no ledger import;
  `VariantState`, the sealed state a wallet exposes; `UnshieldedUtxo`; `NetworkId.StageNet`.
