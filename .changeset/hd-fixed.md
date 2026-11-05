---
'@midnightntwrk/wallet-sdk-hd': patch
---

Fixes and other changes since 3.x

- `HDWallet.clear()` is documented as what it does: it zeroes the root key's private-key buffer. The intermediate keys
  BIP32 allocates along a derivation path, and keys already returned to callers, are left to the garbage collector. No
  behaviour change.
