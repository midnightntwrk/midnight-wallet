---
'@midnightntwrk/wallet-sdk-facade': patch
---

Apply the dust grace period only to transactions that carry shielded offers.

The shielded-offer check in `hasTTLExpired` was inverted: a transaction counted as carrying a fallible offer when it
had none. A pending transaction with no shielded offers and no dust spends was given the dust grace period as its
expiry and dropped from the pending set once that period elapsed, even with its intent deadline still far in the
future. Both ledger versions' traits carried the same inverted check, and both are fixed.

A transaction with no intents at all — a rewards or bridge claim built by `Transaction.fromRewards` — now expires at
the dust grace period too. It carries no deadline of its own, and the indexer never reports a status for it, so without
the backstop it stayed in the persisted pending set, and pending in the history, for good.
