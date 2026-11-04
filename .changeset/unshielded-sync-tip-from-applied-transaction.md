---
'@midnightntwrk/wallet-sdk-unshielded-wallet': patch
---

Report the unshielded wallet as synced as soon as it applies a new transaction. Before, a wallet that had just applied
a transaction kept reporting `isStrictlyComplete() === false` until the indexer's next progress message for the
address. The indexer sends those on a timer that backs off while the address is idle, so after a transfer or a Night
registration on a quiet wallet, the facade's `isSynced` could stay `false` for up to about five minutes.

The highest transaction id the wallet knows for its address now never falls below the last transaction it applied,
and a progress message that predates an applied transaction no longer lowers it. A progress message that names a later
transaction still holds the wallet back until that transaction arrives.
