---
'@midnightntwrk/wallet-sdk-testkit': minor
---

feat(testkit)!: monitor the projections dust sync by default, selectable by DUST_SYNC

The dust and token-transfer healthcheck scenarios now build their wallets on the projections ("event-less") dust sync,
so the networks they monitor are exercised against a sync model wallets actually run. **Breaking** for anyone relying
on those scenarios using the event stream; pass `{ dustWallet: eventBasedDustWallet }` to keep it.

`DUST_SYNC` selects the model for a whole run, as `events` or `projections`. An unrecognized value is rejected rather
than defaulted, because a silent fallback means a typo reports a run as covering one model while it covered the other.
Unset means `events` for testkit-built wallets and `projections` for those two scenarios. `provideWallet` and
`initWalletWithSeed` take `dustWallet` and `manualSync` options that pin a model regardless of the environment — which
is what a test comparing the two models needs, since a control that follows the run is no control at all.

New exports from the root and `/core`: `eventLessDustWallet`, `eventBasedDustWallet`, `dustWalletFor`,
`dustWalletFromEnv`, `manualProjectionsDustSyncOptions` and the `DustWalletFactory` type. `eventLessDustWallet` is the
shipped two-variant dust wallet with the V2 variant's sync service swapped for the projections one, so it reaches the
projections sync on a chain running ledger-v9 from its first block and still builds transactions.

Dust snapshots are namespaced by the model that wrote them. The two disagree on what the single progress value in a
snapshot means, so restoring one into the other resumes at a wrong position; namespacing degrades a model switch to a
from-scratch build instead, with no cache-clearing step to remember.

Three fixes to the settling state waiters. They applied their window to the source rather than to the predicate, so a
wallet syncing in the background — projections emits about every five seconds — starved them until the test timeout
while logging that the condition was already satisfied. They now also answer with the newest value satisfying the
predicate rather than the one from when it first held: `pendingCoins.length === 0` is equally true either side of a
balance arriving, so the old answer could be exactly the stale pre-transaction state the window exists to avoid. And
the token-transfer healthcheck settles pending coins before asserting on them.
