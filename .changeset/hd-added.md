---
'@midnightntwrk/wallet-sdk-hd': minor
---

Additions since 3.x

- `WalletSeeds.fromMasterSeed(masterSeed, { account?, addressIndex?, unshieldedRole? })` derives the shielded, Dust and
  unshielded seeds a wallet starts from (by default account 0, address index 0 and `Roles.NightExternal`), and wipes the
  BIP32 root afterwards. It throws `SeedDerivationError` for a seed it cannot read, or an account or index out of range.
  `WalletSeedsOptions` is the type of its options.
- `Roles.EcdsaUnshielded` (role 4) derives ECDSA unshielded keys under a role of their own, so their secret is never
  shared with the schnorr roles of the same account; pass it as `unshieldedRole`.
