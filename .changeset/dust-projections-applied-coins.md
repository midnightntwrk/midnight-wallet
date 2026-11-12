---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(dust-wallet): keep the projections sync going when a pass finds Dust it already applied

A Dust wallet on the projections sync no longer stops synchronizing when a pass hands back a coin it already applied.
Such a coin is now left out of the update, with a warning from the pass that found it, and the collapsed updates a pass
requests no longer reach back into applied indexes.
