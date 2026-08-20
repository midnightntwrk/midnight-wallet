---
'@midnightntwrk/wallet-sdk-capabilities': minor
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-testkit': patch
---

A wallet that spans a protocol boundary asks the chain where it is before choosing a variant to start at.

A two-variant wallet used to learn the chain's protocol version only from the events it observed, so every start began
on the pre-fork variant. That cost two things. On a chain already past the boundary it paid a hand-over per start: boot
the pre-fork variant, apply nothing, migrate, re-sync. And on a chain that had shown the wallet **no events at all** it
was not a cost but a wrong answer — the wallet stayed pre-fork indefinitely, and since transacting now works on either
side of the boundary, it built transactions with the ledger version the chain does not run, which fail at the node
rather than at the wallet.

The wallet now asks. `chainVersionProbe` answers which protocol version the chain is on; the variant that owns it is
resolved through `variantFor` and started with a fresh state of its own, annotated with the version so it begins inside
its own activation range. On a v9-native chain a default wallet is therefore on the post-fork variant from the first
moment, with the right epoch before a single event has arrived — no hand-over, and no migration emitted.

**The default wallets ask the indexer they are about to synchronize from.** `ShieldedWallet(configuration)`,
`DustWallet(configuration)` and `UnshieldedWallet(configuration)` build the probe from
`configuration.indexerClientConnection` using the same `BlockHash` query the block-data fetcher already runs, so
nothing new is configured and nothing new is asked of the indexer. Applications that would rather ask something else —
a cache, a node RPC, a value they already hold — supply their own `chainVersionProbe` on the configuration.
`CustomForkingShieldedWallet`, `CustomForkingDustWallet` and `CustomForkingUnshieldedWallet` take the same optional
field, and omitting it means no probe at all.

**Best-effort, always.** No probe, a probe that rejects, a probe that outlives the wallet's five-second patience, or a
version no registered variant claims: each leaves the wallet starting exactly where it started before — on the pre-fork
variant, handing over on the first batch that reports a version it does not own. Offline-first applications and
simulator-backed compositions are unaffected. Starting a wallet can now be slower; it cannot newly fail.

Two things the probe deliberately does not decide. An unshielded identity only the post-fork ledger version can hold
(ecdsa) still starts post-fork whatever the chain reports, because there is no decision left for an answer to inform.
And `restore` does not probe at all: a snapshot's own declared version is authoritative, and the variant that wrote it
is the variant that reads it.

`@midnightntwrk/wallet-sdk-capabilities` gains the question itself, under a new `./chainVersion` entry point:
`ChainVersionProbe`, `makeIndexerChainVersionProbe`, `currentChainVersion` and the pure `chainVersionOf`, which reports
nothing at all for a chain that has produced no block rather than guessing the bottom of the timeline.

Projections fast-sync is unchanged and remains a **single-variant** capability (`CustomDustWallet` +
`makeEventLessSyncService`). The probe changes where a wallet begins, not what it can sync with: a two-variant wallet
must be able to read a chain below the boundary, where only the event path exists.

BREAKING CHANGE — the forking wallets' start methods return a promise, because choosing where to begin can mean asking
the chain: `ShieldedWalletClass.startWithSeed` / `.startWithKeys`, `DustWalletClass.startWithSeed` / `.startWithKeys`,
and `UnshieldedWalletClass.startWithPublicKey`. Callers `await` the result and need no other change; factories handed
to `WalletFacade.init` already accept a promise and are unaffected. A seed the SDK will not accept now rejects the
returned promise instead of throwing synchronously. `restore`, `tryRestore` and the single-variant `CustomShieldedWallet`,
`CustomDustWallet` and `CustomUnshieldedWallet` starts are unchanged.
