---
'@midnightntwrk/wallet-sdk-runtime': minor
'@midnightntwrk/wallet-sdk-shielded': patch
---

`StartMaterial.requireAuxFor` resolves the key material a variant should start synchronization with, failing with
`StartMaterial.MissingStartAuxError` — which carries the tag of the variant that asked — when the wallet holds none that
variant can use. Only a wallet started with key objects can reach it: those belong to one ledger version's runtime, so a
variant on the other side of a protocol boundary has nothing to start with, and handing over what the wallet does have
would sync it into nonsense. A wallet started from a seed cannot reach it at all.

The shielded wallet class now retains `StartMaterial` rather than the start-aux it was handed, and resolves per
activating variant through that variant's own `startAux` derivation. A seed-accepting start can therefore serve any
variant the wallet is later migrated to, and a start given key objects accumulates them per variant tag — the same
product a caller holding keys for both protocol versions would supply at once.

Two things this note said of the wallet layer change hand: by the end of this release `startWithSeed` derives both
epochs' key objects eagerly and drops the seed with the calling frame, so what a shielded wallet retains is key
objects for both sides rather than a seed (see *Wallets are started from seeds*); and the shielded wallet is registered
over **two** variants rather than one (see *`ShieldedWallet(configuration)` now registers a variant either side of the
protocol boundary*). At the point of this change it was still single-variant and therefore behaviour-preserving: the
retention and post-migration restart tests passed unmodified.
