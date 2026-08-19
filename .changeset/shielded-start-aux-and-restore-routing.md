---
'@midnightntwrk/wallet-sdk-shielded': major
---

**Both shielded variants now derive their own key material from a seed, and restoring a snapshot routes on the protocol
version it declares.**

**Breaking for anyone composing a `V1Builder`/`V2Builder` chain by hand: `withStartAux` is required.** Each variant
carries a `startAux` capability — given the seed the application started the wallet from, it produces the key material
its own ledger version's sync expects. This is what makes a seed the only key material a wallet needs to hold in order
to cross a protocol boundary: key objects belong to one ledger's runtime and cannot be re-handed to the variant on the
other side, even though the public keys they yield are identical.

`withDefaults()` already includes it, so `ShieldedWallet(config)` and `CustomShieldedWallet(config, new
V2Builder().withDefaults())` need no change. A chain that names its steps individually must add
`.withStartAuxDefaults()` (this ledger version's derivation) or `.withStartAux({ fromSeed })` (its own). It is required
rather than defaulted because the default derivation is only correct for a builder whose sync service expects this
ledger's `ZswapSecretKeys`; a builder that replaced sync is told at build time rather than handed key objects of the
wrong shape at the first migration. `withSync` drops a derivation typed against the previous start-aux parameter, as
`withMigration` already does for the previous-state parameter.

**Restore routes on the snapshot's declared protocol version.** `restore(serializedState)` now peeks at the serialized
envelope and restores into the variant registered for the version it declares, instead of assuming the head variant
wrote it. The peek is deliberately permissive — one optional field, every other ignored — so anything it cannot read is
reported as "no version declared" and the deserializer keeps producing the precise error. A snapshot that declares no
version restores into the head variant, which is what every restore did before there was a choice. A version no
registered variant owns now raises `Restore.UnsupportedSnapshotVersionError`, which carries the version.

**The serialized format is unchanged.** Snapshots already declared their protocol version; nothing written by an earlier
version of this package needs migrating, and nothing this version writes is unreadable by an earlier one.

`peekProtocolVersion` and `variantForSnapshot` are exported from the package root for callers that want to route a
snapshot themselves.
