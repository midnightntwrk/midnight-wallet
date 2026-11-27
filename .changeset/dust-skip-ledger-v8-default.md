---
'@midnightntwrk/wallet-sdk-dust-wallet': minor
---

Skip the ledger-v8 dust history by default, and make the boundary search's timeout configurable.

`skipLedgerV8DustHistory` now defaults to `true`. A fresh `DustWallet` on a chain that crossed `forks.v9` starts on the
V2 variant at the boundary instead of replaying ledger-v8 dust events that the hand-over then discards. It records no
ledger-v8 dust transaction history. Restores are unaffected, and so is a `CustomForkingDustWallet` composition that
does not use `dustWalletProbes`.

The search now runs before every fresh start: two indexer lookups on a chain born on ledger-v9, the indexer client's
10 second event-tip timeout on a chain with no dust event yet, and up to the timeout below with a slow indexer.
`skipLedgerV8DustHistory: false` keeps the previous start exactly.

The search's fixed 30 second ceiling is now `dustTimelineStartTimeout` (any `Duration.DurationInput`, default 2
minutes). On expiry the start still falls back to the full replay. Zero skips the search. A value that is not a
duration fails a fresh start that searches.
