---
'@midnightntwrk/wallet-sdk-testkit': minor
---

feat(testkit): let consumers select the dust sync model

`provideWallet` and `initWalletWithSeed` accept an optional `dustWallet` factory and a `manualSync` flag, and the
dust and token-transfer scenarios forward them via a new `walletOptions` dep. New exports from the root and `/core`:
`eventLessDustWallet`, `eventBasedDustWallet`, `projectionsDustSyncOptions` and the `DustWalletFactory` type.

Purely additive — every default is unchanged, so existing consumers are unaffected. The scenarios and both wallet
builders still use the event-based dust wallet with background syncing.

The `dustWallet` factory applies to the restored and the built-from-scratch paths alike, so a cold state cache
cannot silently fall back to a different sync model than the caller asked for.

Note that the projections-based sync is a **one-shot** sync: where the event-based service's `updates` is a
long-lived indexer subscription, the projections service does one pass up to the block it read at the start and then
ends its stream, and the variant's background retry only re-runs it on failure, not on completion. Opting in
therefore means `projectionsDustSyncOptions` (factory plus `manualSync: true`) *and* driving
`facade.doSync(dustSecretKey)` at every point that would otherwise wait for background convergence — swapping only
the factory leaves a wallet that converges once and then never observes anything again.
