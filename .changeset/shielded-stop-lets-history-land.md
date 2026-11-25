---
'@midnightntwrk/wallet-sdk-shielded': patch
---

fix(shielded-wallet): let a tx-history write about to land finish when the wallet stops

Stopping a shielded wallet straight after a transaction interrupted the write of that transaction's shielded tx-history
section, so the section was never recorded, and nothing wrote it again after a restart. `stop()` now gives the writes
already running up to one second to land, in both the v1 and v2 variants, then interrupts the rest and logs each one as
before.
