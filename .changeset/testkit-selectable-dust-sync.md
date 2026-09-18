---
'@midnightntwrk/wallet-sdk-testkit': minor
---

feat(testkit): let consumers select the dust sync model

`provideWallet` and `initWalletWithSeed` accept an optional `dustWallet` factory and a `manualSync` flag, and the
dust and token-transfer scenarios forward them via a new `walletOptions` dep. New exports from the root and `/core`:
`eventLessDustWallet`, `eventBasedDustWallet`, `projectionsDustSyncOptions` and the `DustWalletFactory` type.
`eventLessDustWallet` is the shipped two-variant dust wallet with the V2 variant's sync service swapped for the
projections one, so it reaches the projections sync directly on a chain that runs ledger-v9 from its first block and
still builds transactions.

Purely additive — every default is unchanged, so existing consumers are unaffected. The scenarios and both wallet
builders still use the event-based dust wallet with background syncing.

The `dustWallet` factory applies to the restored and the built-from-scratch paths alike, so a cold state cache
cannot silently fall back to a different sync model than the caller asked for.

Note that the projections service synchronizes in finite passes rather than over a long-lived indexer subscription: one
pass runs up to the block it read at the start and then ends its stream. Background synchronization re-runs those
passes, so swapping the factory is enough and the usual state waiters behave as they do for the event-based sync. Pair
it with `manualSync` only when a caller wants to decide when each pass happens, and then drive `facade.doSync(seeds)`
accordingly.
