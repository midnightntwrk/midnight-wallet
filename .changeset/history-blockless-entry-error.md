---
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
---

Report a finalized history entry that records no block with its own tagged error.

The simulator transaction-history service, on both variants of the shielded and dust wallets, used to fail two
different ways on one `TransactionHistoryError`: storage had never heard of the transaction, or storage held a finalized
entry restored from a pre-lifecycle history that records no block. A caller that can fetch the block itself had to
string-match the message to tell them apart. The second case is now `BlocklessFinalizedEntryError`, tagged
`Wallet.BlocklessFinalizedEntry` and carrying the transaction hash, so it can be matched on the tag.
`getTransactionDetails` declares it alongside `TransactionHistoryError`. This is a breaking change for a caller that matched
on the `Wallet.TransactionHistory` tag for that case, which now carries `Wallet.BlocklessFinalizedEntry` instead.
