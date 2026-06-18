---
'@midnightntwrk/wallet-sdk-hd': patch
---

`deriveKeyAt`/`deriveKeysAt` now return `keyOutOfBounds` for invalid BIP32 path components (non-integer, negative, or
`>= 2^31` account/role/index values) instead of leaking the underlying `invalid child index` error thrown by
`@scure/bip32`.
