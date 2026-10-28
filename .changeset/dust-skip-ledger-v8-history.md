---
'@midnightntwrk/wallet-sdk-dust-wallet': minor
---

feat(dust-wallet): let a new wallet skip the ledger-v8 dust history

`DustWallet` takes a new `skipLedgerV8DustHistory` option. On a chain that crossed `forks.v9` with ledger-v8 history
behind it, a fresh start with the option set searches the indexer for the last dust event below `forks.v9` and starts
the V2 variant there, with the empty state a wallet crossing the boundary is handed. The ledger-v8 dust events, which
that hand-over would discard, are never replayed. Synchronization then continues by event replay as usual.

**The wallet's dust transaction history from ledger-v8 will be missing**, because no event below the boundary is
applied. The option is off by default and affects fresh starts only: a restored wallet resumes from the cursor its
snapshot carries. It is best-effort, so a chain still below `forks.v9`, one born on ledger-v9, or an indexer that cannot
be searched leaves the start as it is without it. It concerns the dust wallet only; the shielded and unshielded wallets
still read ledger-v8, where the coins they hold from it are found.

The search is a binary search over the dust event subscription, which shares its ids with zswap events, so it steps
over the gaps they leave. It is exported as `findDustTimelineStart`, returning a `DustTimelineStart` (the cursor and the
version of the first ledger-v9 dust event). A `CustomForkingDustWallet` composition opts in by setting the new
`ForkingDustConfiguration.dustTimelineStartProbe` (a `DustTimelineStartProbe`), which a fresh start asks before
`chainVersionProbe`. Purely additive.
