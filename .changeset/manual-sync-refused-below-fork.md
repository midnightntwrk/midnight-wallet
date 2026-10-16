---
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-facade': patch
---

fix(dust,facade): refuse manual sync of a dust wallet below `forks.v9`

Manual sync steps the projections sync service, which needs ledger-v9, so a dust wallet below `forks.v9` cannot be
synchronized by hand. `facade.start(material, { manualSync: true })` used to accept such a wallet and leave nothing to
move it: `doSync()` returned without stepping, or hung on the indexer's event subscription if the wallet held keys.

`start()` now rejects with the new `ManualSyncUnsupportedError` before starting anything, so starting again without
`manualSync` syncs the dust wallet in the background. `DustWallet.stepSync()` and `facade.doSync()` below `forks.v9`
reject with it too. Each rejects with the error itself, carrying the dust wallet's protocol version, so `instanceof`
recognises it.
