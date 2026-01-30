---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': major
'@midnight-ntwrk/wallet-sdk-shielded': major
'@midnight-ntwrk/wallet-sdk-capabilities': minor
'@midnight-ntwrk/wallet-sdk-dust-wallet': major
'@midnight-ntwrk/wallet-sdk-facade': major
---

- expose functions for reverting pending coins (booked for a pending transaction) from a provided transaction
- extract submission into `@midnight-ntwrk/wallet-sdk-capabilities` package as a standalone service and integrate it into the `WalletFacade`
- make `WalletFacade` revert transaction upon submission failure
- change initialization of `WalletFacade` to a static async method `WalletFacade.init` taking a configuration object. This will allow non-breaking future initialization changes when e.g. new services are being integrated into the facade. 
