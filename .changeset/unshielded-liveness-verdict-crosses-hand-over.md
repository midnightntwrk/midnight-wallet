---
'@midnightntwrk/wallet-sdk-unshielded-wallet': patch
---

fix(unshielded-wallet): keep a blocking liveness verdict across the hand-over to the next ledger version

The migration from the V1 to the V2 variant restarted the indexer liveness verdict at `Unknown`, so a node outage right
after the hand-over turned a `Behind` or `WrongNetwork` the wallet had already proven into `Unavailable`, which does not
block completion: `isStrictlyComplete`, `waitForSyncedState` and the facade's `isSynced` opened over an indexer known to
be stale. The verdict is about the one indexer and node the wallet polls whichever variant runs, so `Behind` and
`WrongNetwork` now cross the hand-over as a failed poll would keep them. Every other verdict still restarts at `Unknown`.
