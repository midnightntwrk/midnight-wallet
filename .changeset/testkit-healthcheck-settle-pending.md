---
'@midnightntwrk/wallet-sdk-testkit': minor
---

fix(testkit): settle pending coins before the token-transfer healthcheck asserts on them

The token-transfer healthcheck read its post-transfer assertions off the state `waitForSyncedState()` returns. That state
is a snapshot taken when `isSynced` flips, and pending coins clear shortly *after* — so the snapshot can still carry the
spend's pending entries.

Measured on stagenet: at the instant `isSynced` became true, `dust.pendingCoins.length` was 1 while
`shielded.pendingCoins.length` was already 0, and the dust entry cleared within milliseconds. So
`expect(...dust.pendingCoins.length).toBe(0)` was not testing a property of the wallet — it was racing a snapshot
boundary. The shielded and unshielded equivalents assert the same thing off the same snapshot and were simply winning the
race; nothing guaranteed they would keep winning.

`registerTokenTransferHealthchecks` now waits for `waitForFacadePendingClear` on each wallet before reading its final
state, so the assertions describe the settled wallet rather than the moment they happened to sample.

**This is not a change to `isSynced`, deliberately.** Folding pending coins into the synchronization signal would make a
wallet report un-synced whenever a transaction it submitted was never included, since such a coin stays pending until its
TTL expires — a dropped transaction would then be indistinguishable from a broken sync, and `waitForSyncedState()` would
block on it. The spec treats synchronization progress, the pending pool and transaction history as three separate
concerns for this reason.

Costs roughly 10 seconds per wallet, for the settle window the waiter requires. Consumers running these scenarios against
a monitored network should expect the healthcheck to take about 20 seconds longer.
