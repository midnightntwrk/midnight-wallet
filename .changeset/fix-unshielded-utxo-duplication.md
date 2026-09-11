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
  bookings on every applied update. Past that instant the ledger rejects the transaction, so the booking cannot still be
  valid. A pending entry restored from a snapshot written before this change is released by the first sweep.
- A transaction that has been balanced but not yet proven is recorded as a reservation in the pending-transactions
  service: its identifiers, the ids of the coins it booked, and its TTL, never the transaction itself, which carries key
  material. The record persists, so a booking held for a counterparty that has not answered yet survives a restart. The
  service's existing poll marks a reservation whose TTL has passed, and the facade then releases its coins.
- Bookings restored from a snapshot are released once sync reaches the chain tip, unless a reservation still accounts
  for them, returning an abandoned coin in seconds rather than at its transaction's TTL.
- `UnshieldedWallet.revertUtxos(ids)` releases booked coins without the transaction that booked them, for a caller
  holding only a record of the ids.

BREAKING CHANGE: `UnshieldedState.spend`, `UnshieldedState.spendByUtxo`, `CoreWallet.spend` and `CoreWallet.spendUtxos`
take the TTL of the transaction the coins are booked for as a required last argument. `UnshieldedState.restore` and
`toArrays` exchange pending entries as `{ utxo, ttl, restored }` rather than bare UTxOs, and `TransactingCapability`
gains `revertUtxos` and `releaseRestoredPending`, so a custom implementation of that interface must add them. The public
coin accessors are unchanged: `pendingCoins`, `availableCoins` and `balances` still report UTxOs.

The pending-transactions store gains a new format version carrying reservations. A store written before this change
still loads; one written after it cannot be read by an earlier version of `@midnightntwrk/wallet-sdk-capabilities`.
