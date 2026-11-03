---
'@midnightntwrk/wallet-sdk-capabilities': patch
---

fix(capabilities): stop counting an expired reservation's coins as spoken for

`coveredUnshieldedIds` now leaves out a balanced transaction whose TTL passed before it was submitted: an expired
reservation in the previous release, an `Expired` lifecycle record in this one (`Lifecycle.coveredUnshieldedIds`). No
chain can accept such a transaction any more, so the facade's release of restored bookings frees its coins instead of
keeping them held.
