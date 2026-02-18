---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
---

Extends the unshielded transaction history entry to include the UTXOs created and spent by each transaction.

Each `TransactionHistoryEntry` now carries `createdUtxos` and `spentUtxos` arrays. Every UTXO exposes its `value`, `owner`, `tokenType`, `intentHash`, and `outputIndex`, giving callers full visibility into which coins were received and which were consumed in a given transaction.
