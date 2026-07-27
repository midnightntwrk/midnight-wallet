---
'@midnightntwrk/wallet-sdk-testkit': patch
---

fix(testkit): correct state-waiters that no longer waited for the intended condition

Several `state-waiters` helpers resolved prematurely (or hung) after `submitTransaction` began recording an optimistic *pending* tx-history entry on submit (facade #365):

- `waitForTxInHistory` treated any entry whose top-level `status` was not exactly `'SUCCESS'` as terminal, so it aborted on the freshly-inserted pending entry (`status` undefined) and asserted `expected undefined to be 'SUCCESS'`. It now only aborts on a genuinely terminal outcome (`lifecycle.status === 'rejected'`, or `status` `'FAILURE'`/`'PARTIAL_SUCCESS'`) and keeps waiting while the tx is still pending. This unblocks the token-transfer `@healthcheck` (and the downstream sentinel monitoring that consumes it).
- `waitForStateAfterDustRegistration` treated "tx present in history" as "tx confirmed", which is now true the instant a tx is submitted. It now requires the entry's `status === 'SUCCESS'`.
- `waitForFinalizedShieldedBalance` resolved on the resting pre-transaction state (`pendingCoins.length === 0` is also the idle condition). It now debounces until the state settles before checking.
- `waitForFacadePending` could hang until the whole-test timeout if the pending window was missed. It now fails fast (2 min) with a descriptive error.
