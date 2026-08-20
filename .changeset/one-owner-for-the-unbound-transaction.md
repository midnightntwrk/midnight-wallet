---
'@midnightntwrk/wallet-sdk-shielded': patch
'@midnightntwrk/wallet-sdk-unshielded-wallet': patch
---

`UnboundTransaction` now has one owner. `@midnightntwrk/wallet-sdk-capabilities/proving` declares it — proving is what
produces one, and it is the package both wallets already depend on — and the two wallets re-export that declaration
instead of writing their own.

**Both public entry points still export the name**, and the type is identical to what they exported before, so no
annotation needs to change:

- `@midnightntwrk/wallet-sdk-shielded` → `UnboundTransaction` (re-export; the shielded wallet never built or consumed
  one)
- `@midnightntwrk/wallet-sdk-unshielded-wallet/v2` → `UnboundTransaction` (re-export)

Verified identical before collapsing, and it was three of four rather than four: the pre-fork
`@midnightntwrk/wallet-sdk-unshielded-wallet/v1` declaration names `@midnight-ntwrk/ledger-v8`'s classes, not
`@midnightntwrk/ledger-v9`'s. It is a **different type** and deliberately keeps its own declaration — collapsing it
would make the two ledgers interchangeable in the type system while they stay incompatible at runtime. A test pins
both halves of that: the post-fork type is assignable to the owned one in both directions, and the pre-fork type is
not assignable to it at all.
