---
'@midnightntwrk/wallet-sdk-facade': major
---

fix(facade): release only the failed segments of a partially successful transaction

A transaction that lands as a partial success had its guaranteed segment, and every fallible segment that succeeded,
applied on chain. The facade used to revert it in full in all three wallets, which offered the coins those segments
spent as available again until sync removed them, so a transaction built in that window could pick a spent coin and be
rejected. The facade now releases, in the shielded and unshielded wallets, only the coins booked in the fallible
segments that failed, and releases no Dust at all, because every Dust spend sits in the guaranteed segment. A
transaction that failed outright is still released in full.

BREAKING CHANGE — a custom shielded or unshielded wallet passed to `WalletFacade.init` must implement
`revertFailedSegments(transaction, failedSegments)`, which `ShieldedWalletAPI` and `UnshieldedWalletAPI` now require.
