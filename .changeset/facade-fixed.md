---
'@midnightntwrk/wallet-sdk-facade': patch
---

Fixes and other changes since 4.x

- `initSwap` builds both legs of a mixed shielded/unshielded swap. It built only the leg matching the input kind, so the
  counter-leg's requested output was silently dropped (#554).
- A builder that fails part-way, for example on too little Dust for the fee, releases the coins it booked in the wallets
  before it; the caller had no transaction to revert them with. Balancing in place releases only the coins the wallet
  added.
- A partially successful transaction releases only the coins of its failed segments, and no Dust, since every Dust spend
  is in the guaranteed segment. A transaction that failed outright is still released in full.
- When finalizing a recipe fails, everything the recipe booked is given back.
- The Dust of a transaction balanced but never submitted is released when its TTL passes, not after the Dust wallet's
  grace period.
- Unshielded bookings restored from a snapshot are released at the chain tip unless a live transaction still accounts
  for them, and shielded bookings last no longer than the TTL the caller gave.
- A transaction counts as expired at its earliest intent TTL; only one that spends Dust, carries shielded offers or has
  no intents is held to the Dust grace period after its creation, if that comes first. 4.x held almost every transaction
  to the grace period.
- `effect`, `@midnightntwrk/wallet-sdk-utilities` and `@midnightntwrk/wallet-sdk-hd` are declared as dependencies, so
  the facade installs on its own under strict package managers.
