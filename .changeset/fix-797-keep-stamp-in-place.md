---
'@midnightntwrk/wallet-sdk-unshielded-wallet': patch
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix: keep a transaction's stamp when a wallet signs or balances it in place (#797)

A wallet that changed a transaction it was handed re-stamped it at the lowest version of its epoch (`0` below
`forks.v9`, `forks.v9` from it), whatever the transaction came in with. So a transaction adopted at the version the
chain reports, as `WalletFacade.adoptTransaction` does, came back from `signRecipe` with a different `protocolVersion`,
and a recipe with nothing to sign no longer equalled the one handed over. The side of the fork never changed, so nothing
was routed differently.

Methods that change the transaction they are handed now return it with the stamp it came in with: the unshielded
wallet's `signUnprovenTransaction`, `signUnboundTransaction`, `balanceUnprovenTransaction` and
`balanceUnboundTransaction`, and the dust wallet's `attachDustRegistration`, `addDustGenerationSignature` and
`addDustRegistrationSignature`, on both variants and in the single-variant `CustomUnshieldedWallet` /
`CustomDustWallet`. Transactions a wallet builds itself are stamped as before.
