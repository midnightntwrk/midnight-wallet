---
'@midnightntwrk/wallet-sdk-facade': patch
---

fix(facade): resume wallets restored below `forks.v9` on `start()`

`start()` reduced its material to ledger-v9 keys, so a shielded or dust wallet restored from a snapshot written below
`forks.v9`, which resumes on its V1 variant, failed with `MissingStartAuxError`. A wallet that spans the boundary is now
started from the seeds (`startWithSeed`) or from both key sets (`startWithKeys`); a wallet built for ledger-v9 alone
still gets ledger-v9 keys.
