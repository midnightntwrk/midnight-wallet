---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(dust-wallet): release only the reverted transaction's Dust, keep pending Dust until it settles, and keep it in the snapshot

Reverting a transaction no longer drops Dust coins it never spent. A decaying coin in its last three hours (the Dust
grace period) used to vanish from the wallet, including from its serialized state, until a fresh wallet was restored
from the seed. Reverting also no longer releases coins that other pending transactions still hold.

A coin spent by a pending transaction now stays pending through a sync until it settles: the chain spends it, its lock
runs out, or it decays to nothing. Before, the first event sync after balancing stopped counting it as pending, so
reverting that transaction left the coin locked for the grace period; a sync that first ran after the lock ran out hid
the coin from the available coins for good; and a coin that decayed to nothing stayed pending forever, in both sync
paths.

The dust snapshot now records the pending Dust, so a wallet restored from it can still release the coins its pending
transactions spent. Its format version moves from `v1` to `v2`; this release reads `v1` snapshots, upgrading them with
no pending Dust, but earlier releases refuse a `v2` snapshot.
