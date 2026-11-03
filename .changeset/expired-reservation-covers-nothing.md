---
'@midnightntwrk/wallet-sdk-capabilities': patch
---

fix(capabilities): stop counting an expired reservation's coins as spoken for

`PendingTransactions.coveredUnshieldedIds` now leaves out reservations whose TTL has passed. No chain can accept their
transactions any more, so the facade's release of restored bookings frees those coins instead of keeping them held.
