---
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
---

**`DefaultShieldedConfiguration`, `DefaultDustConfiguration` and `DefaultUnshieldedConfiguration` are no longer aliases
of their head variant's builder configuration.** Each package now declares its own configuration type. The declared
shape is unchanged, so applications that pass a configuration object literal — which is all of them — need to change
nothing.

What breaks is the alias identity. Code that relied on these being the *same type* as `DefaultV2Configuration` no
longer holds; in particular a package-owned configuration will not silently acquire a field that the v2 variant's
builder configuration gains. If you were passing a package configuration straight into a variant builder, or vice
versa, that still compiles today only because the shapes coincide, and the packages now assert that coincidence rather
than assume it: each package has a type test requiring its configuration to stay interchangeable with what **both** its
variants are built from, so a divergence surfaces as a compile error in the SDK instead of as a wallet that cannot be
built for one of its variants. `DefaultV1Configuration` and `DefaultV2Configuration` are unchanged and still exported
from the `./v1` and `./v2` subpaths.

`ShieldedWallet(configuration)` and `UnshieldedWallet(configuration)` now take the package-owned type
(`DustWallet(configuration)` already did). The `Custom*Wallet(configuration, builder)` entry points are unchanged:
those take a variant builder, so a variant's configuration is the right contract there.

The reason for the split: a wallet that spans a protocol boundary is built from more than one variant, so no single
variant's configuration can be the wallet's public contract. The package states what it asks an application for and
maps it onto whichever variants it registers — which is what lets those variants be configured independently of one
another.

Note for dust specifically: `dustParameters` is typed with ledger-v9's `DustParameters`, while the pre-fork variant's
configuration types it with ledger-v8's. One configuration can serve both only because those two classes are
structurally identical; that is now asserted rather than assumed.
