---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
'@midnight-ntwrk/wallet-sdk-shielded': patch
'@midnight-ntwrk/wallet-sdk-capabilities': patch
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
'@midnight-ntwrk/wallet-sdk-facade': patch
---

- expose functions for reverting pending coins from a transaction
- extract submission into `@midnight-ntwrk/wallet-sdk-capabilities` package
- integrate submission to the `WalletFacade`
- make `WalletFacade` revert transaction upon submission failure
- add alternative method for initialization of `WalletFacade`
