---
'@midnightntwrk/wallet-sdk-abstractions': minor
---

Keep the fields a reader does not know in stored snapshots and transaction histories. A payload written by a later
release can carry an optional field this build does not declare; it used to be dropped on read and missing from the
next write, so rolling back, or sharing one storage between two builds, lost it without a word. `SnapshotFormat` gains
`UnknownFields`, `readSnapshotWithUnknownFields`, `writeSnapshot` and `withUnknownFields`, which the wallet packages use
to read such fields and write them back unchanged; `readSnapshot` is unchanged. `InMemoryTransactionHistoryStorage` now
keeps unknown fields on the stored envelope and on every entry, and writes them back on `serialize`. Payloads without
unknown fields are read and written exactly as before.
