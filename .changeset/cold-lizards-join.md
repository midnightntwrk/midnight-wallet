---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
---

fix: add generic to addSignature function, remove intent cloning

- Add generic type parameter to `addSignature` to preserve transaction type instead of always returning `UnprovenTransaction`
- Remove intent cloning via serialization/deserialization
