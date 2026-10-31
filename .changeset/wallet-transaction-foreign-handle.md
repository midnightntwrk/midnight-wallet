---
'@midnightntwrk/wallet-sdk-abstractions': major
---

fix(abstractions)!: refuse a transaction handle another copy of WalletTransaction sealed

`WalletTransaction.unwrapWithin` threw a `TypeError` when handed a handle that another copy of the class sealed, which
is what an application gets with two copies of `@midnightntwrk/wallet-sdk-abstractions` installed side by side: a
handle keeps its transaction in a private field that only the copy that sealed it can read. It now refuses such a handle
with a `ForeignTransactionHandleError`, whose message says to deduplicate the package, before looking at the version the
handle names. `VariantState.unwrapFor` likewise returns nothing for a state another copy sealed.

BREAKING CHANGE:

- `WalletTransaction.unwrapWithin` returns `Either<T, WalletTransactionUnwrapError>`, the union of
  `ProtocolVersionMismatchError` and the new `ForeignTransactionHandleError`, instead of
  `Either<T, ProtocolVersionMismatchError>`. A caller that names the error type names the union.
