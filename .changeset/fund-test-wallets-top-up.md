---
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-testkit': patch
---

`dustWalletProbes(configuration)` is now exported: the probes `DustWallet` asks before a fresh start, including the
search for where the dust timeline reaches `forks.v9` when `skipLedgerV8DustHistory` is set. A composition with its own
variants spreads it into its configuration to start where `DustWallet` would.

The testkit's `eventLessDustWallet` now takes its probes from `dustWalletProbes`, so it honours
`skipLedgerV8DustHistory` as `DustWallet` does. The remote network presets set that flag, so a new wallet on a network
that crossed the v9 fork starts its Dust at the boundary instead of replaying the ledger-v8 history: on qanet a cold sync
drops from tens of minutes to seconds. The undeployed environment leaves it off, because a local chain has no ledger-v8
history to skip. The qanet preset's indexer subscription now uses the indexer host; the host it named does not serve it,
so a wallet restored from a snapshot never connected.
