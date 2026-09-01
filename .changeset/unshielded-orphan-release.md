---
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
---

**Crossing a hard fork now returns UTxOs booked by still-pending transactions to the available balance.** Building a
transaction books its inputs — they move out of the available set and into the pending one — so that a second build
cannot pick the same coins while the first transaction might still land. The crossing used to carry those bookings over
unchanged. It no longer does: every UTxO the pre-fork variant held crosses as available, and the post-fork state
crosses with nothing pending.

The reason a booking cannot survive the boundary is that the transaction it was made for cannot. The transaction codec
moved at the fork, so a transaction built by the pre-fork ledger version can never be included in a post-fork block. A
booking exists only to reserve a coin while its transaction might still land; past the boundary it never can, so the
reservation's reason expires at the boundary itself. Carried over, it would have been permanent — nothing on the
post-fork side can un-book it, because the transaction that would identify the coins is unreadable to the post-fork
ledger, and reverting with the handle the application still holds resolves without doing anything for exactly that
reason. The booking also outlived serialization, so saving and restoring the wallet preserved the stuck state rather
than clearing it.

**What an application sees at the boundary:** the pending balance drops to zero, the available balance rises by the
same amount, and the total is unchanged. No coin appears or disappears; what changes is only whether the wallet
considers it spendable. Applications that never call `revertTransaction`, and wallets restored from a snapshot that no
longer hold the transaction handle, heal too — nothing has to be called for the release to happen.

**Releasing is exact, not merely eventually consistent.** The hand-over fires only once the pre-fork variant has
applied the complete pre-fork timeline: a transaction reported at or beyond the boundary is left entirely unapplied and
only records the version that triggers the migration, and the version signal a quiet chain hands over on is recorded
only when the wallet is caught up on its own transaction ids. So a pre-fork transaction that did land has already
confirmed by the time the migration runs, clearing its own bookings as it was applied, and whatever is still booked
belongs to a transaction that never will land. Confirmation and release cannot disagree in any case: applying a
confirmed spend removes the UTxO from both the available and the pending set, so a released coin the chain then reports
as spent leaves the available balance exactly as if it had never been released.

The shielded wallet has the same shape of problem and cannot yet be fixed the same way — its pending spends live inside
the ledger's own local state, which the SDK cannot edit, and the ledger API meant for clearing them is currently a
no-op. The dust wallet is unaffected: the chain wipes and replays dust state at the fork, so it carries nothing across.
