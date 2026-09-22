---
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-testkit': minor
---

feat(dust-wallet)!: run the projections dust sync in the background

The projections ("event-less") sync synchronizes in finite passes, where the event-based service holds a long-lived
subscription — so a wallet built on it converged once and observed nothing further. Background synchronization now
repeats those passes, each resuming from what the last applied.

**Breaking:** every `SyncService` now states how often background synchronization runs its `updates`, as a required
`backgroundRepeat` of `BackgroundRepeat.Once()` — the answer for a long-lived subscription, which is every service
the SDK ships bar one — or `BackgroundRepeat.WithDelay({ delay })`. A custom sync service must add the field.

The projections service is `WithDelay`, configurable as `backgroundSyncInterval` (milliseconds, default 5000). An
idle pass still re-resolves the wallet's nullifiers, so the interval costs more on a wallet holding Dust than on an
empty one. `facade.doSync()` is unchanged: one pass, then it returns.

Repeating a pass exposed four defects, fixed here:

- A pass emitted one update per resolved Dust spend into a buffer bounded at 16 that nothing drains until the pass
  returns, so a wallet past roughly ten spends deadlocked silently. It is now unbounded.
- Three of a pass's four progress reports dropped a term the fourth counted, flipping `isSynced` on every repeat for
  a wallet that had already caught up.
- Each pass rebuilt the source's indexer clients into the wallet's scope and released none until the wallet stopped.
  Passes now get their own scope; the tx-history fan-out stays on the wallet's.
- A second `start()` forked a second poller, since the sync lock is released between passes. A worker-lifetime guard
  makes it a no-op.

Separately, a failing pass now genuinely backs off at most two minutes, with jitter. Neither bound applied before, so
the delay doubled without limit into days.

Only the ledger-v9 twin's projections service is `WithDelay`: the finite-pass sync, and the buffer fix it needed,
remain ledger-v9 capabilities.

The testkit adds `eventLessDustWallet`, `eventBasedDustWallet`, `projectionsDustSyncOptions` and `DustWalletFactory`,
plus `dustWallet`/`manualSync` options on `provideWallet`, `initWalletWithSeed` and the dust and token-transfer
scenarios. Purely additive. `eventLessDustWallet` syncs but must not transact — it is single-variant V2.
