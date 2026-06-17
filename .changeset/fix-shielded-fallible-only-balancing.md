---
'@midnight-ntwrk/wallet-sdk-shielded': patch
---

Fix `balanceTransaction` failing with "Could not create a valid guaranteed offer" when a
transaction's only imbalance is in a fallible segment. The guaranteed section is now skipped
when it is already balanced, instead of attempting to build an empty guaranteed offer.
