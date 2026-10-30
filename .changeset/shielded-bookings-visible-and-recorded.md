---
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-facade': patch
'@midnightntwrk/wallet-sdk-capabilities': minor
---

Make shielded bookings visible and recorded. `ShieldedWalletState.reservedCoins` lists the coins booked for a
transaction that has not settled, each with `reservedSince` and `releasableAfter`; the coins capability gains an
optional `getReservedCoins`. Not to be confused with `pendingCoins`, which are coins the wallet expects to receive. The
facade records a reservation for every shielded booking, naming the coins by nullifier in the new optional
`inputs.shielded` of the pending-transactions record; stored sets keep loading unchanged. `balanceTransaction`,
`transferTransaction` and `initSwap` on the shielded wallet API take an optional trailing `ttl?: Date`, which caps how
long the coins they book stay booked; the facade passes the TTL it already holds.
