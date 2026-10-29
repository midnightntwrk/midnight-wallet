---
'@midnightntwrk/wallet-sdk-dust-wallet': minor
---

fix(dust-wallet): release only a reverted transaction's Dust, and keep pending Dust until it settles

Reverting a transaction no longer drops decaying Dust coins it never spent, or releases coins other pending
transactions hold. A coin a pending transaction spent now stays pending through syncs, and in the snapshot, until the
chain spends it, its lock runs out or it decays to nothing. Adds `CoreWallet.settlePendingDust`.

The dust snapshot format moves to `v2`. This release reads `v1`, but earlier releases refuse `v2`: downgrading after
this release has written a snapshot means restoring the wallet from its seed.
