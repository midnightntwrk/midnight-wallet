---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(dust-wallet): stop the projections sync deadlocking on wallets with a spend history

A projections-based ("event-less") sync pass emitted one update per resolved Dust spend on top of five fixed ones,
and `doEventlessSync` built its stream with the default `Stream.asyncEffect` buffer, which is bounded at 16. Because
the entire pass runs inside the register effect, Effect does not begin draining the stream until that effect returns
— so every update of a pass had to fit in the buffer at once. The update that overflowed it suspended waiting for
capacity that no running consumer could free, and the pass deadlocked.

The failure was silent: no error, no timeout, no CPU and no network activity, so it presented as a slow sync rather
than a defect. `WalletFacade.isSynced` never became true and `waitForSyncedState()` / `doSync()` never returned. Any
wallet whose deepest Dust chain exceeded roughly ten spends was affected, which is why it did not show against a
short-lived local chain — those wallets are all far below the threshold.

The stream is now created with an unbounded buffer, so a pass is no longer capped by how much Dust the wallet has
spent.
