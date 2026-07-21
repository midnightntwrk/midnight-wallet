---
'@midnightntwrk/wallet-sdk-facade': patch
---

fix(facade): reject mixed shielded/unshielded swaps in `initSwap` (#291)

`WalletFacade.initSwap` only built the leg matching the input kind, so a mixed swap (e.g. shielded input →
unshielded output) silently dropped the counter-leg's requested output and returned a one-legged transaction that
still signed, proved, balanced and submitted. Mixed swaps are not yet supported, so `initSwap` now throws an explicit
error instead of returning a partial transaction, mirroring the existing empty-swap guard.
