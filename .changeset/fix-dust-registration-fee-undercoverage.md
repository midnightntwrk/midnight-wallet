---
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-facade': minor
---

Fix a race in `WalletFacade.registerNightUtxosForDustGeneration` where the registration's
`allow_fee_payment` could be below its own fee, causing the chain to reject submission with
`BalanceCheckOverspend`. The wallet now estimates the fee at build time, reverts the booking,
and throws before submission. Adds `WalletFacade.waitForGeneratedDust(utxos, requiredAmount,
opts?)` so callers can defer registration until enough dust has accrued — pair with
`estimateRegistration` to pick the threshold.
