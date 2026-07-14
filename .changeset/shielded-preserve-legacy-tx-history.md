---
'@midnightntwrk/wallet-sdk-shielded': patch
---

shielded: preserve the embedded tx history of a shielded@1.0.0 snapshot on restore

shielded@1.0.0 embedded the transaction history (raw hex txs) inside the wallet snapshot itself; the
field was dropped at 2.0.0 when tx history moved to separate storage. Restoring a 1.0.0 snapshot with
current code silently discarded that history (Effect Schema ignores unknown keys). The snapshot schema
now carries an optional `txHistory` that is preserved verbatim on restore and re-emitted on serialize,
so a 1.0.0 restore no longer loses data. Snapshots written by 2.0.0+ never carry the field, so their
serialized shape is unchanged.
