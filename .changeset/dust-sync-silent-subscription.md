---
'@midnightntwrk/wallet-sdk-indexer-client': patch
'@midnightntwrk/wallet-sdk-dust-wallet': patch
'@midnightntwrk/wallet-sdk-shielded': patch
---

fix(dust-wallet,shielded-wallet): notice an event subscription that stays open but stops delivering

An indexer that stopped writing to the dust or zswap event subscription while its socket stayed open raised nothing, so
a wallet that was behind waited on it for as long as the connection lasted: its position stood still,
`progress.isConnected` stayed `true`, and it carried on only if something else dropped the connection. The dust and
shielded wallets now give up on such a subscription: when a wallet is behind the highest event id it knows the timeline
to hold and nothing arrives for 30 seconds, the sync fails, and the retry that already handles a dropped connection
reconnects and resubscribes from the last event applied. On both variants of each wallet.

A wallet level with the timeline is left alone, because a quiet chain is silent too, and so is a wallet on a chain with
no events of that kind. A wallet that has synced before expects the event at its cursor back within 30 seconds of
subscribing, since that event is known to exist.

In the indexer client, `BackpressureOptions` takes an optional `stall`: `tip` reads the highest key off an item, and
`knownTip` names the highest key the caller already knows of. A subscription given up on fails with a `ServerError`.
Without `stall` a subscription behaves as before.
