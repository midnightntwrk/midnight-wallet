---
---

test(unshielded-wallet): guard the indexer liveness gate where callers meet it

- The sync service's liveness feed starts from the wallet's own verdict, so a failed poll after the hand-over cannot
  turn a carried `Behind` into `Unavailable`. Covered in both twins.
- `waitForSyncedState` waits through `Behind`, `WrongNetwork` and a first verdict not yet in, on both the forking and
  the single-variant wallet, and resolves once the indexer is reported in sync.
- `FacadeState.isSynced` is false while the unshielded wallet alone is not complete.
- Against the local stack, a node on a different chain yields `WrongNetwork` and holds `isStrictlyComplete()` and
  `waitForSyncedState` back. The node is the stack's own image, started from the `dev` chain spec with one inert
  genesis key added.

The fork test harness gains two opt-in settings, a liveness feed and a source that stays open, so a timeline wallet can
stay connected at the tip.
