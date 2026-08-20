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

The derivation is pinned against the specification rather than against itself. The Wallet Specification gains a
**Per-wallet seeds** section naming which role each of the three seeds comes from, the spec reference implements that
walk over BIP-32 independently of this package, and the vectors it generates (`seedDerivation.json`) are what these
tests assert against. They reproduce the values this package already derived, which is what makes them a statement of
what a Midnight wallet is rather than a record of what this package happened to do.
