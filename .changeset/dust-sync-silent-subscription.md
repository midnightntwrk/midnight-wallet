---
'@midnightntwrk/wallet-sdk-indexer-client': patch
'@midnightntwrk/wallet-sdk-dust-wallet': patch
'@midnightntwrk/wallet-sdk-shielded': patch
---

fix(dust-wallet,shielded-wallet): notice an event subscription that stays open but stops delivering

A dust or zswap event subscription that an indexer stopped writing to, with its socket still open, left a wallet that
was behind waiting for as long as the connection lasted. Both wallets, on both variants, now give up on it: when a
wallet is behind the highest event id it knows of and nothing arrives for 30 seconds, the sync fails and the existing
retry reconnects and resubscribes from the last event applied. A wallet level with the timeline, or on a chain with no
such events, is left alone.

In the indexer client, `BackpressureOptions` takes an optional `stall` (`tip`, `knownTip`); a subscription given up on
fails with a `ServerError`.
