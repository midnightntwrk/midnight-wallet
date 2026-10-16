---
'@midnightntwrk/wallet-sdk-shielded': major
---

Release shielded coins booked for a transaction that is never submitted or never included. Such a booking was saved
with the wallet and never cleared, so an abandoned transaction locked its coins for good, across restarts. The wallet
now expires its own bookings during sync, with or without the facade: once the lesser of the transaction's TTL and
mainnet's `global_ttl` (14 days) has passed since sync first saw the booking, and only once sync has caught up. The
facade passes its own default TTL of one hour to every shielded build, so a booking taken through it still lasts at
most an hour. The sync source checks in every version-watch interval, so a chain with no shielded traffic still
releases. Each booking's first-seen time and TTL are saved in the snapshot as an optional `bookings` field; older
snapshots still load and their bookings get a full lifetime from the first update.

BREAKING CHANGE for custom sync sources only: every events update now carries `now`, the instant the source stamped it.
`EventsWalletSyncUpdate` gains a required `now: Date` and `WalletSyncUpdate.create` takes it as a third argument, in
both the `v1` and `v2` subpaths. The default indexer and simulator services already stamp their updates.
