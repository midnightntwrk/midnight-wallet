---
'@midnightntwrk/wallet-sdk-abstractions': minor
---

`ProtocolVersion.epochOf(version, forkVersion)` names the range of protocol versions on the same side of a protocol
boundary as a given version — what the SDK means by "the same ledger version made these bytes". Everything that routes
on a version is really asking which epoch it belongs to, so the boundary is computed in one place and the two ends of
that question, the wallet stamping a transaction and the caller unwrapping it, cannot disagree.
