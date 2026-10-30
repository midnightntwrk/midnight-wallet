---
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-facade': major
---

fix: release only the failed segments of a partially successful transaction

A partially successful transaction used to be released in full, offering coins the chain had spent until sync caught
up. The facade now calls the new `revertFailedSegments(transaction, failedSegments)` on the shielded and unshielded
wallets, which releases only the coins booked in the fallible segments that failed, and releases no Dust, since every
Dust spend is in the guaranteed segment. A transaction that failed outright is still released in full.

BREAKING CHANGE — `revertFailedSegments` is now required on `ShieldedWalletAPI`, `UnshieldedWalletAPI` and both
`Transacting` capability types, and `extractOwnFailedFallibleInputs` on the unshielded `TransactionOps`. Custom
implementations, including wallets passed to `WalletFacade.init`, must add them.
