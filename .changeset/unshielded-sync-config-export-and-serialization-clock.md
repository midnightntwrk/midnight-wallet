---
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
---

feat(unshielded-wallet): export the sync configuration, and let serialization take a clock

The package exports `DefaultUnshieldedSyncConfiguration`, `NodeClientConnection` and `resolveNodeEndpoint`, so an
application can type the liveness settings (`nodeClientConnection`, `livenessConfiguration`, `livenessPollInterval`) it
passes to the wallet.

`makeDefaultV1SerializationCapability` and `makeDefaultV2SerializationCapability` take an optional `{ clock }`. It dates
a booking restored from a snapshot written before bookings carried an expiry; the default is system time, as before.
