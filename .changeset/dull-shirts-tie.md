---
'@midnightntwrk/wallet-sdk-capabilities': minor
---

Add a _tag discriminator to InsufficientFundsError so consumers can identify it reliably across package boundaries,
where instanceof checks are unreliable because a duplicated copy of the class may be loaded.
