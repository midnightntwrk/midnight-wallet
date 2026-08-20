---
'@midnightntwrk/wallet-sdk-hd': minor
---

`WalletSeeds.fromMasterSeed(masterSeed, options?)` names the walk from one master seed down to the three per-wallet
seeds, and wipes the BIP32 tree before it returns. Six near-identical copies of that walk existed across this
repository, each writing out the same three derivations and each silently discarding the failure branches.

`options` selects the account, the address index, and which role the unshielded seed comes from — `Roles.NightExternal`
by default, which is the signing scheme that works on both sides of the protocol boundary, or `Roles.EcdsaUnshielded`
for a wallet that will sign with ECDSA.

It throws rather than returning a result: this sits at a boundary an application calls directly and its failures are
programming errors, not ordinary states. `HDWallet` remains for a caller that would rather branch on a tagged result.

The derivation is pinned by test against its current behaviour, not against a published specification: the
spec-reference vectors cover the hop *after* this one and take the per-wallet seed as given, so nothing published states
what a master seed derives to per role. What the vectors protect is that naming the walk changed nothing.
