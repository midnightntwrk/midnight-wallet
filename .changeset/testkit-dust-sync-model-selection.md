---
'@midnightntwrk/wallet-sdk-testkit': minor
---

feat(testkit)!: select the dust sync model by configuration, and keep the two models' snapshots apart

Switching a test lane between the two dust sync models previously meant editing every file that built a wallet, and
remembering to clear the state cache in one of the two directions. Four changes remove both problems.

**`DUST_SYNC` selects the model for a whole run.** `dustWalletFromEnv()` is now the default behind the `dustWallet`
option of `provideWallet` and `initWalletWithSeed`, so `DUST_SYNC=projections` switches every wallet the testkit builds
while a test that needs a specific model still pins it in code. Unset means the event-based sync, as before. An
unrecognized value throws rather than falling back — a typo must not report a run as covering one sync model when it
covered the other. New exports: `DustSyncModel`, `dustWalletFor`, `parseDustSyncModel`, `dustSyncModelFromEnv`,
`dustWalletFromEnv`.

**Dust snapshots are namespaced per sync model.** A snapshot carries one progress value, `appliedIndex`, and the two
models disagree about what it means: the event-based service treats it as a ledger-event cursor, the projections service
writes a composite of tree indices and nullifier count. Restoring across models therefore resumed an event subscription
from a position that is not an event id, and silently skipped events. Dust snapshots now live at
`dust-<model>-<filename>` (`dustSnapshotPath`), so a model switch finds no snapshot and rebuilds from scratch instead.
There is no longer a cache to clear by hand in either direction. Shielded and unshielded snapshots are
model-independent and unchanged.

**Breaking: `saveState` takes the `WalletInit`, not the facade.** It needs the sync model to pick the snapshot
namespace, and taking both separately would let them disagree:

```diff
- await saveState(wallet.wallet, syncCacheDir, filename);
+ await saveState(wallet, syncCacheDir, filename);
```

`WalletInit` gains a `dustSyncModel` field recording the model the wallet was actually built with, from whichever
source.

**Breaking: `projectionsDustSyncOptions` no longer implies `manualSync`.** It now selects the projections sync with
background synchronization — the case almost every caller wants, and the one the name suggests. The previous pairing is
`manualProjectionsDustSyncOptions`, for a caller that drives each pass with `facade.doSync()`. Spreading the old
constant into a test that waits on the state stream would block, which is a trap the old name did nothing to signal.

Also fixes `provideWallet`'s "unable to sync restored wallet" fallback, which rebuilt on the default dust sync instead
of the requested one, silently dropping the caller's choice of model on that path.
