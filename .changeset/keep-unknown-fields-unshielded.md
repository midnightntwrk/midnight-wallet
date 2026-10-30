---
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
---

Keep the snapshot fields this build does not declare. Both variants put them on the new optional
`CoreWallet.unknownFields` when restoring, carry them through every change to the wallet, including the cross-ledger
migration (`PreviousLedgerWallet` gains the same optional field), and write them back unchanged on the next save. A
field written by a later release therefore survives a rollback. Snapshots without unknown fields are read and written
exactly as before.
