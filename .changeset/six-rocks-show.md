---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
'@midnight-ntwrk/wallet-sdk-shielded': patch
'@midnight-ntwrk/wallet-sdk-abstractions': patch
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
'@midnight-ntwrk/wallet-sdk-facade': patch
---

- Moved `SyncProgress` from `wallet-sdk-shielded/v1` into `wallet-sdk-abstractions` so it can be shared across wallet implementations
- Refactored `CoreWallet` in the dust wallet from a class to a plain object type + namespace, improving composability
- Added `WalletError` type to the dust wallet for structured error handling
- Added coin data to unshielded transaction history
- Removed unused `wallet-sdk-hd` dependency from `wallet-sdk-unshielded-wallet`
- Cleaned up `ProgressUpdate` type and `progress()` method from `TransactionHistoryCapability` in the shielded wallet (superseded by the shared `SyncProgress`)
