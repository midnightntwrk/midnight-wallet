---
'@midnightntwrk/wallet-sdk-facade': minor
'@midnightntwrk/wallet-sdk-capabilities': minor
---

fix(facade): keep a submitted transaction's coins and Dust booked unless the failure proves no block holds it

`WalletFacade.submitTransaction` used to release every shielded, unshielded and Dust booking of a transaction on any
submission error, and mark its lifecycle record `Reverted`. A finality timeout, an unparseable block number, or a stream
ending early can all come after the transaction is in a block, so the wallets offered coins and Dust already spent until
sync caught up.

Now a failed submission releases the bookings only when the failure proves this send is in no block, and this was the
only send of the transaction. The failure proves it when the node usurped or invalidated the transaction, its pool
refused it with one of the author RPC's refusal codes, no connection was made so it was never sent, a step before
sending failed, or the simulator discarded it. It was the only send when no other send of it was awaiting the node, its
lifecycle record showed no earlier send, end or revert when the send started (in this session, or in one before a
restart that restored the records), the record showed no end when the send failed, and the transaction's TTL had not
passed. A node refuses a transaction a block already holds the same way it refuses one it never saw, so only the first
send can tell.

Every other failure keeps the bookings, and the record stays as it is, until sync or the transaction's TTL settles
them. That includes:

- the node dropping the transaction from its own pool, since a peer it was broadcast to can still include it;
- the node answering that it already holds the transaction (1013) or has temporarily banned it (1012);
- an application's own error;
- a retry, a resend after `revert`, or a send while another of the same transaction is in flight.

Holding a coin until the TTL only delays it; releasing one a block spent would offer it again.

The error still reaches the caller either way. When the release runs and a step of it fails, the caller gets an
`AggregateError` holding the submission error first, then each wallet's failed release, then each failed update of the
lifecycle record or history entry; its message says whether a booking may remain or only the record or entry failed to
move. Every step runs whichever others fail. `submitTransaction` now also reads the lifecycle records before sending, so
a lifecycle service whose `state()` fails makes it reject without sending.

This is a minor release of the facade, not a patch: `submitTransaction` can now reject with an `AggregateError`, and
which failures release a transaction's bookings has changed. A `SubmissionService` supplied by the application that
rejects with an error other than a `SubmissionError` whose cause proves exclusion now keeps the transaction's bookings
until sync or the TTL settles them, where it used to release them at once.

Capabilities exports `classifySubmissionFailure` and `SubmissionFailure`, which read what a submission service's
rejection says about whether this send is in a block. A `SubmissionError` is recognised by its tag, bare or inside the
fiber failure `Effect.runPromise` rejects with. It also exports `Lifecycle.isCoveredBy`, which says whether a lifecycle
record stands for the same spend as a transaction.
