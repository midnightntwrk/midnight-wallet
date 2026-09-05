---
'@midnightntwrk/wallet-sdk-facade': patch
'@midnightntwrk/wallet-sdk': patch
---

Stamp a finalized transaction with the protocol version it was authored at, rather than the version the wallets have
reached by the time its proof comes back. Proving is a long await, so an ordinary block — or the hand-over to ledger-v9
— can land under it; the transaction's bytes were fixed before the prover was called, and the handle returned by
`finalizeTransaction` and `finalizeRecipe` now says so. Previously such a transaction came back claiming the version
reached during proving, which sent its bytes to the wrong ledger version on submission, reversion and deserialization,
and hid it from orphaning. The pending entry these methods record is stamped the same way, so orphaning judges a
transaction by what authored it.

Finalizing a transaction whose epoch the wallets left while it was being proved now fails with
`ProtocolVersionMismatchError`, naming the version it was authored for and the range the facade accepts, and reverts
the reservations it made in the shielded, unshielded and dust wallets. No chain the wallets are on can include such a
transaction, so it is refused rather than recorded as pending to wait out a TTL.
