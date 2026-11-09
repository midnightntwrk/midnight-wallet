---
'@midnightntwrk/wallet-sdk-facade': patch
'@midnightntwrk/wallet-sdk-capabilities': minor
---

fix(facade): keep a submitted transaction's coins and Dust booked unless the failure proves no block holds it

`WalletFacade.submitTransaction` used to release every shielded, unshielded and Dust booking of a transaction on any
submission error, and mark its lifecycle record `Reverted`. A finality timeout, an unparseable block number, or a stream
ending early can all come after the transaction is in a block, so the wallets offered coins and Dust already spent until
sync caught up.

Now the bookings are released only when the node usurped, dropped, invalidated or refused the transaction, when no
connection was made so it was never sent, or when the simulator discarded it. After any other failure the record stays
`Submitted` and sync or the transaction's TTL settles the coins. The error still reaches the caller either way.

A `SubmissionService` supplied by the application that rejects with its own error now falls in the second group: its
bookings stay until sync or the TTL settles them.

Capabilities exports `classifySubmissionFailure` and `SubmissionFailure`, which read what a submission service's
rejection says about the transaction's inclusion.
