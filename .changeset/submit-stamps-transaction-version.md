---
'@midnightntwrk/wallet-sdk-facade': patch
---

fix(facade): book a submitted transaction under its own protocol version

`submitTransaction` now records a pending transaction with the protocol version its bytes were built for. It used to
record the version the wallets last reported, which was `none` until all three had reported and could differ from the
transaction's own once a crossing landed between building and submitting.
