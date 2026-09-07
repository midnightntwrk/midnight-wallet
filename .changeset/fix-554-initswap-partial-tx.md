---
'@midnightntwrk/wallet-sdk-facade': patch
---

fix(facade): build both legs of a mixed shielded/unshielded swap in `initSwap` (#554)

`WalletFacade.initSwap` only built the leg matching the *input* kind, so a mixed swap (e.g. shielded input →
unshielded output) silently dropped the counter-leg's requested output and returned a one-legged transaction that
still signed, proved, balanced and submitted. Each leg is now built whenever its part is present — a leg may be all
give (inputs) or all want (outputs) — so mixed swaps carry both the give and want sides.
