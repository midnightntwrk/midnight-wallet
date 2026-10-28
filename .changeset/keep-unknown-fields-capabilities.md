---
'@midnightntwrk/wallet-sdk-capabilities': minor
---

Keep the top-level fields of a stored pending-transactions payload that this build does not declare. `deserialize` puts
them on the new optional `PendingTransactions.unknownFields`, every state transition carries them, and `serialize`
writes them back unchanged, so a field written by a later release survives a rollback. Payloads without unknown fields
are read and written exactly as before.
