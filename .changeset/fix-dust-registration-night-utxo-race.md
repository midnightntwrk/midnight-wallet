---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': minor
'@midnight-ntwrk/wallet-sdk-dust-wallet': minor
'@midnight-ntwrk/wallet-sdk-facade': patch
---

Fix a race where Dust registration / deregistration would double-use Night UTxOs that another in-flight transaction was already trying to spend. The build flow now books the chosen Night UTxOs (available → pending) at build time, so a conflicting concurrent build fails immediately with `SpendUtxoError` instead of only at submission. Adds new methods on `UnshieldedWallet` (`createDustActionBookingTransaction`) and `DustWallet` (`splitNightUtxosForDustAction`, `attachDustRegistration`) to support the split build; facade signatures are unchanged.
