---
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-facade': minor
---

feat: reject an underfunded dust registration with a typed `InsufficientDustForFeeError`

`WalletFacade.registerNightUtxosForDustGeneration` used to reject a first-time registration whose generated dust could not yet pay its own fee with a plain `Error`, the amounts only in its message. It now rejects with `InsufficientDustForFeeError` (`_tag` `'Wallet.InsufficientDustForFee'`), part of the dust wallet's `WalletError` union in both variants. It carries `claimableFeePayment`, `fee` and `shortfall` in Specks, and an `estimate` of when generation will cover the fee: `Reachable` with the seconds and the moment, or `Unreachable` with the reason (`NoGeneration`, `ExceedsCap`). The message keeps its old opening and still points at `waitForGeneratedDust`, and the booked Night UTxOs are still released before the rejection.

Match it on `_tag`: each variant declares its own class, so `instanceof` depends on which one was imported.

The dust wallet gains `ensureFeeCoverage(currentTime, nightUtxos, fee)`, which rejects with the error itself rather than a fiber wrapper, and `feeCoverageEstimate` on its coins-and-balances capability.
