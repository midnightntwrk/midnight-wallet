---
'@midnightntwrk/wallet-sdk-utilities': minor
---

Additions and changes since 1.2

- A `./testing/variants` subpath with `eitherCoreStateOf(walletState, v2CoreStateOf, v1CoreStateOf)`, which reads the
  sealed core state of a wallet state produced by either of a wallet's two variants.
- `runNodeContainer`, `runProofServerContainer` and `runTxGenerator` in `./testing` start ledger-v9 images: proof server
  `9.0.0-rc.10` (was `8.1.0`), and node and node toolkit `2.1.0-rc.4` (was `0.22.0`). A proof server serves one ledger
  version, so a test that still proves ledger-v8 transactions needs a container on the `8.1.0` image: its own, or one
  that the `adjustment` callback returns in place of the default.
