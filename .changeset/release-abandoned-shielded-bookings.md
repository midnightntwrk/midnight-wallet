---
'@midnightntwrk/wallet-sdk-shielded': patch
---

Release shielded coins booked for a transaction that is never submitted or never included. Until now such a booking
was saved with the wallet and never cleared, so an abandoned transaction left its coins unspendable for good, across
restarts. The wallet now expires its own bookings during sync, whether or not it is used through the facade: a booking
is released once the ledger's default `global_ttl` (one hour) has passed since sync first saw it — after that no spend
built from it can be included — and only once sync has caught up with the chain.

The deadline is saved in the wallet snapshot as an optional `bookingDeadlines` field, so a restart does not extend how
long a coin stays locked. Snapshots written before this change still load; their bookings are given a full lifetime from
the first sync update after loading.
