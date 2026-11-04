---
'@midnightntwrk/wallet-sdk-testkit': patch
---

Fixes and other changes since 0.2

- The package installs from npm: 0.2.0 shipped its internal dependencies as `workspace:^`, which npm and Yarn reject.
  Its internal dependencies are now exact versions, and `effect`, which the token-transfer scenario imports, is declared
  as a dependency, so the package resolves under strict package managers.
- The state waiters wait for what they name. `waitForTxInHistory` waits past a pending entry and stops only at a final
  outcome, and `waitForStateAfterDustRegistration` requires a successful entry. `waitForFacadePendingClear` and
  `waitForUnshieldedCoinUpdate` apply their settling window to the condition instead of debouncing the source, and
  `waitForFinalizedShieldedBalance` gains one; each answers with the newest value that satisfies the condition, so a
  wallet syncing in the background no longer starves them, and none answers with the pre-transaction state. The settling
  waiters time out after 180 seconds, and `waitForFacadePending` fails after two minutes instead of hanging.
- The token-transfer healthcheck settles pending coins before asserting on them.
