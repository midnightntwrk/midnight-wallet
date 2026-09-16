---
'@midnightntwrk/wallet-sdk-shielded': patch
---

Stop discarding the transaction history embedded in a 1.0.0 snapshot.

Shielded 1.0.0 stored the transaction history inside the wallet snapshot as `txHistory`. When history moved to its own
storage the field was dropped from the schema, and because unknown keys are ignored on decode, those snapshots restored
without any error and lost the history on the next save — silently, with nothing to notice it by.

The field is now read back into the wallet and written out untouched. The SDK neither reads nor adds to it; it only
stops throwing it away. A snapshot that never carried `txHistory` does not gain one: the field is written only when it
was read. Every snapshot does now gain `version: 'v1'`, which is a separate change described in its own changeset.
