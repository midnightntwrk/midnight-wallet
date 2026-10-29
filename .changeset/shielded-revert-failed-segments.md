---
'@midnightntwrk/wallet-sdk-shielded': major
---

feat(shielded-wallet): release only the coins of a transaction's failed segments

The shielded wallet gains `revertFailedSegments(transaction, failedSegments)`. For a transaction that landed as a
partial success, it releases only the coins booked in the fallible segments that failed. The coins that the guaranteed
section and the successful segments spent stay booked until sync settles them.

BREAKING CHANGE — `revertFailedSegments` is a required member of `ShieldedWalletAPI` and of the `Transacting`
capability type exported from `./v1` and `./v2`. A custom implementation of either must add it; one that has no
segment-level bookings can release nothing, or fall back to `revertTransaction` where releasing spent coins is
acceptable.
