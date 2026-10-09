---
'@midnightntwrk/wallet-sdk-facade': patch
---

fix(facade): declare `@midnightntwrk/wallet-sdk-utilities` and `@midnightntwrk/wallet-sdk-hd` as dependencies. The facade re-exports `Clock` from the first at runtime and names `WalletSeeds` from the second in its public `FacadeStartMaterial` type, so a consumer needs both installed rather than reached through another package.
