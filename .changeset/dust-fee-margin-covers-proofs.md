---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

The fee the wallet pays now carries the full `feeBlocksMargin` of the transaction the node sees. Fees used to be priced
on proof-erased transactions, which the ledger prices accurately only for transactions submitted without proofs, so the
margin fell short by the cost of the proofs, including the wallet's own Dust spend. `calculateFee`, `estimateFee`,
`dryRunFee` and balancing now price the proven form: an unproven transaction is mock-proved and an unbound one is bound.
The balancing intent the wallet returns is the one it priced, so the margin holds on every balance. The optional
trailing parameter of `dryRunFee` now carries the merged transactions in the form they are priced in, no longer
proof-erased.

When one of the transactions balanced together has no proven form (it is proof-erased, or unproven with contract
calls), the whole set, the wallet's own Dust spend included, is priced proof-erased, as before. A ledger failure while
binding a transaction now fails balancing instead of falling back to that pricing.

Through the facade, `calculateTransactionFee` and `estimateTransactionFee` now quote the higher, proven-form fee, and
the first-time Dust registration check requires generated Dust to cover that fee, so a registration at the old
threshold is refused with `InsufficientDustForFeeError`.
