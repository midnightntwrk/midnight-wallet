---
'@midnightntwrk/wallet-sdk-dust-wallet': major
---

fix(dust-wallet): release only a reverted transaction's Dust, and keep pending Dust until it settles

Reverting a transaction no longer drops decaying Dust coins it never spent, or releases coins other pending
transactions hold, including a coin a later transaction booked again after the first one's lock ran out. A coin a
pending transaction spent now stays pending through syncs, and in the snapshot, until the chain spends it, its lock runs
out or it decays to nothing. Adds `CoreWallet.settlePendingDust`.

The dust snapshot format moves to `v2`. This release reads `v1`, but earlier releases refuse `v2`: downgrading after
this release has written a snapshot means restoring the wallet from its seed.

BREAKING CHANGE — `CoreWallet.pendingDust` (exported from `./v1` and `./v2`) now holds `PendingDust` entries,
`{ coin, nullifier, declaredTime }`, in place of the flat `DustWithNullifier`, which is removed. Read a pending coin's
fields from `entry.coin`.
