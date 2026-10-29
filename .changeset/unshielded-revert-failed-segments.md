---
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
---

feat(unshielded-wallet): release only the coins of a transaction's failed segments

Adds `revertFailedSegments(transaction, failedSegments)`. For a transaction that landed as a partial success, it
releases only the wallet's own inputs of the fallible offers in the segments that failed, while the coins its guaranteed
offers and its successful segments spent stay pending until sync settles them.
