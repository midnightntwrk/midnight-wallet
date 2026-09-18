---
'@midnightntwrk/wallet-sdk-hd': patch
---

docs(hd): narrow `HDWallet.clear()` to the guarantee it actually gives

`clear()` was documented as clearing "internals from private data, so that they do not reside in memory longer than
needed", which reads as though the seed is gone from the process. It calls `wipePrivateData()` on the root `HDKey`,
which zeroes that one key's private-key buffer; the intermediate keys BIP32 allocates at each level of a derivation
path, and the derived keys already returned to callers, are not reachable from `HDWallet` and are left to the garbage
collector. The JSDoc now says so. No behaviour change.
