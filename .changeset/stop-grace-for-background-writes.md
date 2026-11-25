---
'@midnightntwrk/wallet-sdk-runtime': minor
'@midnightntwrk/wallet-sdk-shielded': patch
'@midnightntwrk/wallet-sdk-facade': patch
---

fix: let a shielded tx-history write about to land finish when the wallet stops

Stopping a shielded wallet straight after a transaction interrupted the write of that transaction's shielded
tx-history section, so the section was never recorded, and nothing wrote it again after a restart.

- `@midnightntwrk/wallet-sdk-runtime`: `Variant.VariantContext` gains an optional `runBeyondVariant`, which runs work
  beyond the variant that starts it, across a hand-over, until the wallet stops. Stopping the wallet first stops the
  running variant, then gives that work up to `Variant.BACKGROUND_WORK_GRACE` (one second), once for the whole wallet,
  and only then interrupts the rest, logging how many it interrupts. A defect in such work is logged. Every `stop()`
  called while the wallet is stopping now resolves only once it has stopped; a second call used to resolve at once.
  `runBeyondVariant` replaces `VariantContext.runtimeScope`, which only pre-release builds carried.
- `@midnightntwrk/wallet-sdk-shielded`: tx-history writes run through `runBeyondVariant`, so `stop()` lets a write
  about to land finish. `stop()` can take up to a second longer while a write is still running; a write still running
  after that is interrupted, logged with its transaction hash, and not recorded, as before.
- `@midnightntwrk/wallet-sdk-facade`: `WalletFacade.stop()` stops the shielded wallet, so it too can take up to a second
  longer while a shielded tx-history write is still running.
