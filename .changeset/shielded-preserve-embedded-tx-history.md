---
'@midnightntwrk/wallet-sdk-shielded': patch
---

Stop discarding the transaction history embedded in a 1.0.0 snapshot.

Shielded 1.0.0 stored the transaction history inside the wallet snapshot as `txHistory`. When history moved to its own
storage the field was dropped from the schema, and because unknown keys are ignored on decode, those snapshots restored
without any error and lost the history on the next save — silently, with nothing to notice it by.

The field is now read back into the wallet and written out untouched. The SDK neither reads nor adds to it; it only
stops throwing it away. Snapshots written since 1.0.0 never carried the field and are byte-for-byte unchanged.
