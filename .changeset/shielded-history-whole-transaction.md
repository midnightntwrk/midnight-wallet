---
'@midnightntwrk/wallet-sdk-shielded': patch
---

Record a shielded transaction's history entry only once all of its events have been applied. The sync groups indexer
events into batches, and a batch can end in the middle of a transaction: a spend's input event comes before its output
events, so one batch saw the spent coin and the next saw the change. Each batch wrote its own history section, and
whichever write finished first was what a reader saw, so a sender's entry could briefly show `spentCoins: []`.

The wallet now holds back the last transaction of a batch until the next batch shows it is complete, the wallet
catches up with the indexer, or the sync timeline ends, and then writes it once with every coin it spent and received.
