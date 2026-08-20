---
'@midnightntwrk/wallet-sdk-facade': minor
---

The facade now exports `AnyTransaction`, the type its own public signatures already took.

`calculateTransactionFee`, `estimateTransactionFee`, `revert`, `revertTransaction` and
`BalancingRecipe.getTransactions` all name this type, but it was reachable only as
`@midnightntwrk/wallet-sdk-dust-wallet/v2`'s `AnyTransaction` — a variant-scoped internal of a package a facade-only
app need not depend on at all, and one with a differently-typed pre-fork twin under `/v1`. Annotating a variable, or
writing a wrapper around any of those methods, meant importing from that subpath.

Additive: `import { type AnyTransaction } from '@midnightntwrk/wallet-sdk-facade'`. Existing imports from the dust
subpath keep working — the facade's name is an alias to that same type, deliberately so it cannot drift from what the
methods accept.

**Ownership decision.** The facade names it, rather than dust promoting it to a documented public export, because the
facade has a single entry point and was exporting nothing for a type in five of its public signatures, while dust's
declaration sits under `v2/types/` with a v8 twin under `v1/types/` — variant-scoped, and not a type whose identity
survives the fork. This is transitional: `WalletTransaction` handles replace these signatures, at which point the
protocol version a transaction was authored for travels with it instead of being lost at this boundary, and the alias
goes away with them.
