---
'@midnightntwrk/wallet-sdk-shielded': minor
---

feat(shielded-wallet): release only the coins of a transaction's failed segments

The shielded wallet gains `revertFailedSegments(transaction, failedSegments)`. For a transaction that landed as a
partial success, it releases only the coins booked in the fallible segments that failed. The coins that the guaranteed
section and the successful segments spent stay booked until sync settles them.
