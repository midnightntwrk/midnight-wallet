---
---

test(unshielded-wallet): guard the indexer liveness gate where callers meet it

- The sync service starts its liveness feed from the wallet's own verdict — after a hand-over, the one the migration
  carried — so a failed poll cannot turn `Behind` into `Unavailable`. Covered in both twins.
- `waitForSyncedState` waits while the indexer is `Behind` and resolves once it is in sync, on both the forking and the
  single-variant wallet.
- `FacadeState.isSynced` is false while any one of its three wallets is not complete.

The fork test harness gains two opt-in settings, a liveness feed and a source that stays open, so a timeline wallet can
stay connected at the tip.
