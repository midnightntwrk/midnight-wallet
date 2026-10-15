---
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-facade': patch
---

fix(dust,facade): refuse manual sync of a dust wallet below `forks.v9`

Manual sync steps the projections sync service, which only ledger-v9 supports. A forking `DustWallet` on its V1 variant
resolved `stepSync()` without stepping, so `facade.doSync()` over a wallet below `forks.v9`, such as one restored from a
snapshot written there, did nothing. Both now reject with the new `ManualSyncUnsupportedError`; below `forks.v9` a dust
wallet synchronizes in the background once started.
