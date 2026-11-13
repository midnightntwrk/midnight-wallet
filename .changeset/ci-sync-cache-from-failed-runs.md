---
'@midnightntwrk/wallet-sdk-testkit': patch
---

`registerDustHealthchecks` and `registerTokenTransferHealthchecks` now default their timeouts to 45 minutes, up from 15,
so a wallet built from scratch on a long-lived network such as preprod can finish syncing. `registerDustHealthchecks`
now also applies its `timeout` to the `beforeEach` that builds and syncs the wallet. That hook previously ran under the
test runner's own hook timeout (10 seconds by default in Vitest), so a caller that passes its own `timeout` now has it
bound the wallet's setup as well.
