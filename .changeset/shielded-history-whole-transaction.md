---
'@midnightntwrk/wallet-sdk-shielded': patch
---

Record a shielded transaction's history entry only once all of its events have been applied. The sync groups indexer
events into batches, and a batch can end in the middle of a transaction: a spend's input event comes before its output
events, so one batch saw the spent coin and the next saw the change. Each batch wrote its own history section, and
whichever write finished first was what a reader saw, so a sender's entry could briefly show `spentCoins: []`.

The wallet now holds back a transaction only when a batch ends inside it, that is, when it is the transaction of the
batch's last applied event. It writes it once, with every coin it spent and received, as soon as the next batch applies
another transaction's event, the wallet catches up with the indexer, or the wallet moves past the variant's protocol
versions. A transaction followed by another in the same batch is written straight away.

Closing the wallet, or its variant at a hand-over, writes any transaction it is still holding, so a wallet stopped
mid catch-up records the part it applied and the rest merges onto it on resume. Closing also no longer cuts off
tx-history writes still in flight: it waits up to 5 s for them, so a hand-over pauses and `stop()` takes up to 5 s
longer while writes are pending. A write still retrying because the indexer lags behind the node is stopped after
that, and its entry is not recorded.
