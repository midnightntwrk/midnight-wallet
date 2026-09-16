---
'@midnightntwrk/wallet-sdk-facade': minor
---

Export `finalizedTransactionTraits` from the facade.

The registry of traits pending transactions are read with was internal to the facade. The serialization compatibility
tests restore stored pending-transaction payloads and have to read them exactly as the wallet does — building a second
trait for that would freeze a copy rather than the thing that ships.
