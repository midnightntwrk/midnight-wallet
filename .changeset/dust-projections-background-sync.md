---
'@midnightntwrk/wallet-sdk-dust-wallet': minor
---

feat(dust-wallet): make the projections sync work under background synchronization

The projections ("event-less") sync synchronizes in finite passes — each pass ends its own stream — where the
event-based service holds a long-lived subscription. Background synchronization reads the wallet state once and runs
`updates` once, and its retry only re-runs a pass on failure, not on completion. A wallet built with the projections
sync and started in the background therefore converged once and then never observed anything again, silently. The
only usable shape was `manualSync` plus an explicit `facade.doSync()` at every point that would otherwise wait for
the background sync to catch up.

A sync service can now declare `backgroundRepeatDelay`, and background synchronization re-runs its pass on that
delay. Because the pass is re-run from the top, each one re-reads the wallet state and resumes from what the previous
one applied. The projections service declares it; the event-based and simulator services do not, and are unaffected
— their `updates` never completes, so nothing repeats.

The delay is configurable as `backgroundSyncInterval` (milliseconds, default 5000) on the dust wallet's sync
configuration. Passes cannot overlap at any interval: a pass that cannot take the sync lock yields to the one already
running and waits for the next interval. An idle pass costs a single block query, because both the generation
subscription and the commitment load short-circuit on an unchanged tip.

`facade.doSync()` is unchanged — it still runs exactly one pass and returns.
