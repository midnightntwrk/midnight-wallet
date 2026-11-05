---
'@midnightntwrk/wallet-sdk-unshielded-wallet': patch
---

Fixes and other changes since 3.x

- A booked UTxO is no longer re-admitted as available on resync, which doubled the balance and was saved that way. A
  snapshot that holds one coin as both available and pending loads it as pending only, so such a wallet repairs itself
  on its next start.
- Bookings are released once sync has caught up and their transaction's TTL has passed; a booking for a transaction that
  was never submitted used to stay for good. Bookings restored from a 3.x snapshot, which carry no TTL, get one hour
  from loading.
- Balancing a transaction in place books the coins it selects, and does not select one coin for two segments.
- A partially successful transaction releases only the coins booked in its failed fallible segments.
- Sync refuses a transaction delivered below its position (`OutOfOrderSyncUpdateError`), and the spend of a UTxO the
  wallet does not hold, instead of applying them, and then retries from the same position. A boundary transaction the
  indexer delivers again is ignored rather than applied and recorded twice.
- The wallet reports itself synced as soon as it applies a new transaction, rather than waiting for the indexer's next
  progress message, which comes on a timer that backs off while the address is idle; a progress message older than an
  applied transaction no longer holds it back.
- `isConnected` clears when the indexer subscription drops or ends, and the subscription is rebuilt in both cases; it
  used to stay `true`. The sync's retry back-off is really capped at two minutes.
