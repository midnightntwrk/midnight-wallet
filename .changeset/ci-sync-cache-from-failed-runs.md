---
'@midnightntwrk/wallet-sdk-testkit': patch
---

`registerDustHealthchecks` and `registerTokenTransferHealthchecks` now allow 45 minutes by default, up from 15, for a
wallet to build and sync, so a wallet built from scratch on a long-lived network such as preprod can finish.
`registerDustHealthchecks` now applies its `timeout` to the `beforeEach` that builds and syncs the wallet as well as to
its tests; that hook previously ran under the test runner's own hook timeout, which is 10 seconds by default in Vitest.
