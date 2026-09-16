---
'@midnightntwrk/wallet-sdk-facade': patch
---

Apply the dust grace period only to transactions that carry shielded offers.

The shielded-offer check in `hasTTLExpired` was inverted: a transaction counted as carrying a fallible offer when it
had none. A pending transaction with no shielded offers and no dust spends was given the dust grace period as its
expiry and dropped from the pending set once that period elapsed, even with its intent deadline still far in the
future. Both ledger versions' traits carried the same inverted check, and both are fixed.
