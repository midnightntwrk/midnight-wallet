---
'@midnightntwrk/wallet-sdk-abstractions': patch
'@midnightntwrk/wallet-sdk-facade': patch
'@midnightntwrk/wallet-sdk': patch
---

Preserve finalized transaction history when a late verdict rejects a transaction whose inclusion sync has already
recorded. A delayed pending-status check, a TTL, or a protocol upgrade orphaning a pre-boundary transaction can all
arrive after the transaction landed, including under a different on-chain hash when it was aggregated. Such a verdict
now clears the transaction from the pending set instead of recording a rejection, and an included failure still
releases its unexecuted coin reservations. The facade's protocol-version tracking no longer performs any fallible work,
so a history storage failure cannot stop it from observing later versions or orphaning stranded transactions.

History storage implementations must give recorded inclusion precedence over a later rejection: `gotRejected` writes
nothing for a transaction a finalized entry already covers, by hash or by carrying all of its identifiers (an empty
identifier set covers nothing), and `gotFinalized` clears every pending or rejected entry it covers under another hash.
The predicate is exported as `TransactionHistoryStorage.coversTransaction`. `mergeWalletEntries` keeps a finalized
lifecycle over an incoming rejected one.
