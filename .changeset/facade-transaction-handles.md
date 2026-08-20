---
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk': major
---

The facade speaks transaction handles, and enforces which side of the protocol boundary it is on.

BREAKING CHANGE — every public method that took or returned a ledger transaction now takes or returns a
`WalletTransaction` handle: `submitTransaction`, `validateTransaction`, the three `balance*` methods,
`finalizeTransaction`, `finalizeRecipe`, `signUnprovenTransaction`, `signUnboundTransaction`, the two fee methods,
`revert`/`revertTransaction`, and the three recipe types. `AnyTransaction` is still the name the fee and revert methods
are stated in terms of; it is now an alias of `AnyTx`.

BREAKING CHANGE — **the `secretKeys` parameters are gone** from `transferTransaction`, `initSwap`, the three `balance*`
methods and `estimateTransactionFee`. The wallets derive their own.

BREAKING CHANGE — `finalizeTransaction` no longer takes an optional protocol version, and no longer falls back to the
version the wallets have reached. The stamp on the transaction is authoritative: it is the version that fixed the
bytes, so a fork landing between building and proving cannot send them to the wrong prover.

**Enforcement.** At every point a transaction enters the facade it is accepted only if it was built on the side of the
boundary the facade is currently on, and refused with a `ProtocolVersionMismatchError` otherwise. That covers a
transaction an application authored and sealed itself, a transaction stranded by a crossing, and — because a merge
across the boundary is not a failure to compute but an impossibility — every merge the facade performs for balancing.

`validateTransaction` routes on the transaction's own stamp instead: well-formedness asks whether the ledger version
that produced these bytes would accept them, and a fork landing afterwards cannot change the answer or who gives it.

`FacadeState.pending` is now a set of handles. The pending machinery reads each entry with the trait registered for the
version it was authored at, and the pre-fork entry is now a **genuine ledger-v8 trait** rather than the current
version's standing in for it — so a transaction the fork stranded is recognised as stranded, by a reader that can
actually read it, instead of waiting out a TTL for an inclusion that can never happen.
