---
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-facade': patch
'@midnightntwrk/wallet-sdk-capabilities': minor
---

Make shielded bookings visible and recorded.

`ShieldedWalletState.reservedCoins` lists the coins booked for a transaction that has not settled, each with
`reservedSince` (when sync first saw the booking) and `releasableAfter` (when the wallet will release it if nothing
settles it first). Not to be confused with `pendingCoins`, which are coins the wallet expects to receive. The coins
capability gains an optional `getReservedCoins`; a capability that does not implement it reports no reserved coins.

The facade now records a reservation for every shielded booking it makes, naming the coins by nullifier in the new
optional `inputs.shielded` of the pending-transactions reservation record, and clears it with the booking. Like the
unshielded section, it records who holds the coins; the shielded wallet itself releases them once they expire. The
field is optional, so stored pending-transaction sets keep loading unchanged.

`balanceTransaction`, `transferTransaction` and `initSwap` of the shielded wallet API take an optional trailing
`ttl?: Date`. It caps how long the coins they book stay booked: they are released after the TTL if nothing settles
them first, and never later than the ledger's default `global_ttl` (one hour) after sync first sees them. The facade
passes the TTL it already holds.
