---
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
---

feat(unshielded-wallet): release only the coins of a transaction's failed segments

Adds `revertFailedSegments(transaction, failedSegments)`. For a transaction that landed as a partial success, it
releases only the wallet's own inputs of the fallible offers in the segments that failed, while the coins its guaranteed
offers and its successful segments spent stay pending until sync settles them.

BREAKING CHANGE — `revertFailedSegments` is a required member of `UnshieldedWalletAPI` and of the `Transacting`
capability type, and `extractOwnFailedFallibleInputs` of the `TransactionOps` type, all exported from `./v1` and
`./v2`. A custom implementation of any of them must add the new member.
