---
'@midnightntwrk/wallet-sdk-runtime': minor
'@midnightntwrk/wallet-sdk-shielded': major
---

Two changes that let one wallet read state produced by either of two variants.

**`StartMaterial.requireDerivedAuxFor` / `StartMaterial.seedOf` (runtime).** A wallet's public API speaks one ledger
version's key objects, but the variants either side of a protocol boundary do not agree on that type.
`requireDerivedAuxFor` serves the odd one out from a retained seed, failing with `MissingStartAuxError` when the wallet
holds key objects instead — there is nothing to convert, because key objects belong to one ledger version's runtime.
`seedOf` exposes the seed arm directly.

**Breaking (shielded): `ShieldedWalletState` no longer exposes `capabilities` or `services`.** It now holds projections
already bound to the variant that produced the emission, rather than a capability set and a state side by side. The two
variants' capability types are structurally identical, so a capability belonging to one type-checks against a state
belonging to the other and would be silently wrong at runtime; binding them at the point where the producing variant is
known takes the pairing out of the type system's hands. `ShieldedWalletState.mapState` is replaced by
`ShieldedWalletState.fromVariant(variant, emission)`, which is generic over the state type so that the pairing is
checked.

**Everything observers read is unchanged** — `balances`, `totalCoins`, `availableCoins`, `pendingCoins`,
`coinPublicKey`, `encryptionPublicKey`, `address`, `progress`, `protocolVersion` and `serialize()` keep their names,
types and meaning, and their tests pass unmodified. The one widening is `state`, now the union of the two variants' core
states (`ShieldedCoreState`) — the single member the ledger version surfaces on, everything else being version-agnostic
plain data.
