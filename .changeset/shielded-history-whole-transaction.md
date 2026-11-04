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

Closing a variant at a hand-over no longer cuts off tx-history writes still in flight: it waits up to 30 s for them to
finish before stopping them.
