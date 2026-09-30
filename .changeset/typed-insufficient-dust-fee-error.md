---
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-facade': minor
---

feat: reject an underfunded dust registration with a typed `InsufficientDustForFeeError`

`WalletFacade.registerNightUtxosForDustGeneration` used to reject a first-time registration whose generated dust could not yet pay its own fee with a plain `Error`, the amounts only in its message. It now rejects with `InsufficientDustForFeeError` (`_tag` `'Wallet.InsufficientDustForFee'`), part of the dust wallet's `WalletError` union in both variants. It carries `claimableFeePayment` (the fee payment the transaction was built with), `fee` and `shortfall` in Specks, and an `estimate` of when generation will cover the fee: `Reachable` with the seconds and the moment, or `Unreachable` with the reason (`NoGeneration`, `ExceedsCap`). The message keeps its old opening and always names `waitForGeneratedDust`: with a timeout long enough to see the estimate out when the fee is reachable, or saying it will not help when it is not. The booked Night UTxOs are still released before the rejection.

Recognise it with `isInsufficientDustForFeeError(error)`, exported from the dust wallet package root: each variant declares its own class, so `instanceof` against one alone misses the other.

The dust wallet gains `ensureFeeCoverage(currentTime, nightUtxos, feePayment, fee)`, which judges the attached fee payment and rejects with the error itself rather than a fiber wrapper, and `feeCoverageEstimate` on its coins-and-balances capability.
