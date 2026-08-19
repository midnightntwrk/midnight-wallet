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
activating variant through that variant's own `startAux` derivation. `startWithSeed` retains the seed, so a wallet built
from one can start synchronization on any variant it is later migrated to. `start(keys)` accumulates key objects per
variant tag — the same product a caller holding keys for both protocol versions would supply at once — and a retained
seed supersedes them, being strictly more capable.

Behaviour-preserving for a wallet registered over a single variant, which is every shielded wallet this release builds:
the retention and post-migration restart tests pass unmodified.
