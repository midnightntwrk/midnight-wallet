---
'@midnightntwrk/wallet-sdk-facade': minor
'@midnightntwrk/wallet-sdk-capabilities': minor
---

fix(facade): keep a submitted transaction's coins and Dust booked unless the failure proves no block holds it

`WalletFacade.submitTransaction` used to release every booking on any submission error, including errors raised after
the transaction was already in a block (finality timeout, unparseable block number, stream ending early), so the
wallets offered spent coins and Dust until sync caught up.

Now it releases only when the failure proves this send is in no block (usurped, invalid, a pool refusal code, never
sent, or a simulator discard) and it was the only send of the transaction: no other send in flight, no earlier send,
end or revert in its lifecycle record, and its TTL not passed. Everything else, `Dropped` included, keeps the bookings
until sync or the TTL settles them. The error still reaches the caller.

Minor rather than patch: when the release itself fails, `submitTransaction` rejects with an `AggregateError` (the
submission error first, then each failed release or record update), and an application `SubmissionService` that
rejects with its own error no longer gets its bookings released at once.

Capabilities exports `classifySubmissionFailure`, `SubmissionFailure` and `Lifecycle.isCoveredBy`.
