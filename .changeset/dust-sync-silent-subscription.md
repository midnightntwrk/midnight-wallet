---
'@midnightntwrk/wallet-sdk-indexer-client': patch
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(dust-wallet): notice a dust event subscription that stays open but stops delivering

An indexer that stopped writing to the dust event subscription while its socket stayed open raised nothing, so a wallet
that was behind waited on it for as long as the connection lasted: its position stood still, `progress.isConnected`
stayed `true`, and it carried on only if something else dropped the connection. The wallet now gives up on such a
subscription: when it is behind the highest event id it knows the timeline to hold and nothing arrives for 30 seconds,
the sync fails, and the retry that already handles a dropped connection reconnects and resubscribes from the last event
applied. On both variants.

A wallet level with the timeline is left alone, because a quiet chain is silent too, and so is a wallet on a chain with
no dust events. A wallet that has synced before expects the event at its cursor back within 30 seconds of subscribing,
since that event is known to exist.

In the indexer client, `BackpressureOptions` takes an optional `stall`: `tip` reads the highest key off an item, and
`knownTip` names the highest key the caller already knows of. A subscription given up on fails with a `ServerError`.
Without `stall` a subscription behaves as before.
