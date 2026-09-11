---
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-capabilities': minor
'@midnightntwrk/wallet-sdk-facade': minor
---

fix(unshielded-wallet): stop a leaked booking duplicating a UTxO and doubling the balance

`availableUtxos` and `pendingUtxos` are disjoint by construction, and every balance accessor sums them independently, so
a UTxO present in both is counted twice. Two defects combined to produce exactly that: the indexer sync path re-admitted
a created UTxO that was still booked, and nothing released a booking taken while balancing when the transaction was
abandoned before submission. Persisted, the result survived every restart.

- `applyUpdate` no longer admits a created UTxO that is currently booked, the guard the simulator path already had, and
  loading a snapshot holding one coin in both maps keeps it on the pending side only. State already corrupted in the
  field repairs itself on the next start.
- A booked coin now carries the TTL of the transaction it was booked for, and both sync capabilities release expired
  bookings as updates arrive. This is the only thing that releases a booking, so two sweeps on different clocks cannot
  free the same coin twice. It runs only once sync has caught up with the chain, because a replay from an earlier cursor
  can still be carrying the transaction that spent a booked coin, and it releases strictly after the TTL rather than at
  it, because the ledger accepts an intent while its TTL is at or after the block's timestamp.
- A transaction that has been balanced but not yet proven is recorded as a reservation in the pending-transactions
  service: its identifiers, the ids of the coins it booked, and its TTL, never the transaction itself, which carries key
  material. In-place balancing records only the coins the wallet moved onto the pending side, not inputs the caller had
  already put in the transaction. A reservation is dropped wherever its booking is reverted, and when its TTL passes.
- Bookings restored from a snapshot are released once sync reaches the chain tip, unless a reservation or a transaction
  being tracked still accounts for the spend, returning an abandoned coin in seconds rather than at its transaction's
  TTL.
- Balancing a transaction in place now books the coins it selects, so two balance calls can no longer select the same
  coin.
- `UnshieldedWallet.revertUtxos(ids)` releases booked coins without the transaction that booked them, for a caller
  holding only a record of the ids.

BREAKING CHANGE: `UnshieldedState.spend`, `UnshieldedState.spendByUtxo`, `CoreWallet.spend` and `CoreWallet.spendUtxos`
take the TTL of the transaction the coins are booked for as a required last argument. `UnshieldedState.restore` and
`toArrays` exchange pending entries as `{ utxo, ttl, restored }` rather than bare UTxOs, and `TransactingCapability`
gains `revertUtxos` and `releaseRestoredPending`, so a custom implementation of that interface must add them. The public
coin accessors are unchanged: `pendingCoins`, `availableCoins` and `balances` still report UTxOs.

Both stored formats gained an optional member rather than a new version, so a store written by this release is still
readable by an earlier one: the unshielded snapshot carries each booking's expiry, and the pending-transactions store
carries its reservations. A pending entry restored from a snapshot that predates expiries is granted a full transaction
lifetime from the moment it is loaded.
