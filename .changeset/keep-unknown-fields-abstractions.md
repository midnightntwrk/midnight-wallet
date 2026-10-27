---
'@midnightntwrk/wallet-sdk-abstractions': minor
---

Keep the fields a reader does not know in stored snapshots and transaction histories. A payload written by a later
release can carry an optional field this build does not declare; it used to be dropped on read and missing from the
next write, so rolling back, or sharing one storage between two builds, lost it without a word. `SnapshotFormat` gains
`UnknownFields`, `readSnapshotWithUnknownFields`, `writeSnapshot` and `withUnknownFields`, which the wallet packages use
to read such fields and write them back unchanged; `readSnapshot` is unchanged. `InMemoryTransactionHistoryStorage` now
keeps the unknown top-level fields of the stored envelope and of every entry beside the entries, not on the decoded
entry values, and writes them back on `serialize`; a merge cannot drop them, and an entry still decodes and encodes
with exactly the fields its schema declares. A top-level `__proto__` is carried as an ordinary field, never applied
as a prototype. Payloads without unknown fields are read and written exactly as before.
