---
'@midnightntwrk/wallet-sdk-testkit': minor
---

fix(testkit): stop the settling state waiters starving while a wallet is syncing

`waitForFacadePendingClear`, `waitForFinalizedShieldedBalance` and `waitForUnshieldedCoinUpdate` placed
`rx.debounceTime(10_000)` **upstream** of the `rx.filter` carrying their predicate. `debounceTime` suppresses emissions
until the source has been silent for 10 seconds, so the predicate was only ever evaluated during a 10-second gap in
wallet state updates — and on an actively syncing wallet no such gap occurs. The waiters blocked until the test timeout
while logging that their condition was already satisfied, which reads as "the waiter is ignoring its own predicate".

A Dust wallet syncing from projections in the background makes this deterministic rather than occasional: it emits about
every 5 seconds indefinitely, so a 10-second debounce can never fire. Measured on stagenet, the largest gap between
consecutive emissions over a 90-second window was 6 seconds. Two tests burned their full timeout in a single run —
600000 ms and 900000 ms — and with the suite's `retry: 1` each paid twice, roughly 50 minutes of lane time on conditions
that were already met.

The settle window is now applied to the predicate instead of the source, via a new exported `waitForStableState`
primitive: the condition must hold *continuously* for the window, so a steady stream of satisfying updates no longer
resets the timer. `distinctUntilChanged` on the predicate is load-bearing — without it `switchMap` cancels and restarts
the timer on every emission and the starvation reproduces.

Two further changes fall out of it:

- Each waiter now fails after 180 s with a message stating the condition was genuinely unmet, rather than running to the
  enclosing test timeout. An unsatisfiable wait is now legible and cheap instead of silent and slow.
- `waitForStableState` is exported and consumed by the duplicate waiters in `e2e-tests`, so the subtle part is
  single-sourced and the two copies cannot drift.

Callers are unaffected: the waiters keep their signatures and still resolve with a state that satisfies their condition.
That state is the one captured when the condition began to hold, carried through the pipeline, because the source may
only be subscribed once — the facade's `state()` replays its current value on subscribe but a sub-wallet's `state` does
not, so re-reading it would receive nothing on an already-settled wallet and the wait would never resolve. Callers
needing the very latest state should follow with their own read.
