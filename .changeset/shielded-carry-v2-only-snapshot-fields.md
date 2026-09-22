---
'@midnightntwrk/wallet-sdk-shielded': patch
---

Stop the V1 shielded reader discarding a field only the V2 twin writes.

Both shielded variants write format version `v1`, so a snapshot written by either is the other's shape — except that the
V2 variant writes `coinHashesPending` while crossing `forks.v9`, and the V1 schema had never heard of it. Unknown keys
are ignored on decode, so the V1 reader accepted such a snapshot, dropped the field, and wrote it back without it: the
same silent loss as the embedded `txHistory`, in the field added to describe a crossing.

No application could reach it. A snapshot carrying `coinHashesPending` was written by a V2 wallet from `forks.v9`, and
the wallet layer routes a snapshot to the variant that owns its `protocolVersion`, so the V1 reader is never handed one;
no single-variant composition is built from V1 either. The fix is to the reader's promise rather than to any behaviour
an application sees: a reader must not accept what it cannot represent and then throw it away.

The field is now declared on the V1 schema and carried through untouched, exactly as `txHistory` is. The V1 variant
never sets it and never reads it, and a snapshot that did not carry one does not gain one, so what a V1 wallet writes is
byte-for-byte what it wrote before.
