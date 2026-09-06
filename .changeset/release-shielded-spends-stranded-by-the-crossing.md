---
'@midnightntwrk/wallet-sdk-shielded': patch
'@midnightntwrk/wallet-sdk': patch
---

Release the shielded coins a wallet had booked for a ledger-v8 transaction still in flight when the chain handed over to
ledger-v9. Those reservations cross the boundary with the rest of the local state, and nothing on the far side could
ever clear them — the transactions holding them belong to a ledger version the chain has left, so no inclusion will
report them and the reversion the facade performs on orphaning cannot reach a ledger-v8 transaction from the V2 variant.
The affected coins were therefore missing from the available set, from coin selection and from the available balance for
the remainder of the wallet's life.

The first sync update after a crossing now releases every reservation the wallet arrived with, in the same step that
computes its coin hashes, before the balances are read: the coins return at the Merkle indices the chain gave them, in a
tree of unchanged height and root, and spend normally. It runs once per crossing, so a reservation made from
`forks.v9` onwards — whose transaction can still be included — is untouched. The change outputs those stranded
transactions would have paid back are left as they were, and nothing ever removes them: they stay in `pendingOutputs`
for the life of the wallet and overstate the pending balance. That is a known limitation, and a mild one — those entries
reserve no coin and block no spending.
