---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(dust-wallet): pay the full fee margin of the transaction as proven

The fee the wallet pays now carries the full `feeBlocksMargin` of the transaction the node sees. Fees used to be priced
on proof-erased transactions, which the ledger prices accurately only for transactions submitted without proofs, so the
margin fell short by the cost of the proofs, including the wallet's own Dust spend. `calculateFee`, `estimateFee`,
`dryRunFee` and balancing now price the proven form: an unproven transaction is mock-proved and an unbound one is bound.
A transaction with no proven form, proof-erased or unproven with contract calls, is still priced as it is. The optional
trailing parameter of `dryRunFee` now carries the merged transactions in the form they are priced in.
