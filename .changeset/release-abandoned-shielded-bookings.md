---
'@midnightntwrk/wallet-sdk-shielded': patch
---

Release shielded coins booked for a transaction that is never submitted or never included. Until now such a booking
was saved with the wallet and never cleared, so an abandoned transaction left its coins unspendable for good, across
restarts. The wallet now expires its own bookings during sync, whether or not it is used through the facade: a booking
is released once the lesser of the transaction's TTL and the ledger's default `global_ttl` (one hour) has passed since
sync first saw it — after that no spend built from it can be included — and only once sync has caught up with the chain.
The sync source checks in every version-watch interval, so a chain with no shielded traffic still releases.

The wallet records the transaction's TTL itself when it books the coins, because the ledger does not keep it. Each
booking's first-seen time and TTL are saved in the wallet snapshot as an optional `bookings` field, so a restart does
not extend how long a coin stays locked. Snapshots written before this change still load; their bookings are given a
full lifetime from the first sync update after loading.
