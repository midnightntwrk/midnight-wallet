---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(dust-wallet): release only the reverted transaction's Dust, and keep pending Dust pending through a sync

Reverting a transaction no longer drops Dust coins it never spent. A decaying coin in its last three hours (the Dust
grace period) used to vanish from the wallet, including from its serialized state, until a fresh wallet was restored
from the seed. Reverting also no longer releases coins that other pending transactions still hold.

A coin spent by a pending transaction now stays pending through a sync until the chain spends it or its lock runs out.
Before, the first sync after balancing stopped counting it as pending, so reverting that transaction left the coin
locked for the grace period; and a sync that first ran after the lock ran out hid the coin from the available coins
for good.
